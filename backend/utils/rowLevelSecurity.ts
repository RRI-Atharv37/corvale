import { AsyncLocalStorage } from 'async_hooks'
import { Types } from 'mongoose'

import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'

export interface RlsContext {
    userId: string
}

export interface RlsPluginOptions {
    /** Model supports shared workspace resources scoped by workspaceId. */
    supportsWorkspace?: boolean
}

export const RLS_BYPASS = 'rlsBypass'

/**
 * Aggregate-only opt-in. The RLS guard inspects outer `$match` stages, so a `$lookup` /
 * `$graphLookup` / `$unionWith` pulls a second collection past the tenancy boundary
 * unchecked (P6 / SEC-58). Cross-collection stages are therefore rejected under an RLS
 * context unless the caller sets this option, asserting it has scoped the joined pipeline
 * by hand. The outer `$match` scope check still applies; use `RLS_BYPASS` to skip both.
 */
export const RLS_ALLOW_LOOKUP = 'rlsAllowLookup'

const CROSS_COLLECTION_STAGES = ['$lookup', '$graphLookup', '$unionWith'] as const

const rlsStorage = new AsyncLocalStorage<RlsContext>()

export const runWithRlsContext = <T>(context: RlsContext, fn: () => T): T => {
    return rlsStorage.run(context, fn)
}

export const getRlsContext = (): RlsContext | undefined => {
    return rlsStorage.getStore()
}

export const isRlsActive = (): boolean => {
    return rlsStorage.getStore() !== undefined
}

const isObjectIdLike = (value: unknown): boolean => {
    if (value instanceof Types.ObjectId) {
        return true
    }
    if (typeof value === 'string' && Types.ObjectId.isValid(value)) {
        return true
    }
    return false
}

const isIdListLookup = (idValue: unknown): boolean => {
    // `{ _id: { $in: [<ObjectId>, ...] } }` — the filter Mongoose's `populate()` issues, and
    // the shape of any post-fetch "load these specific rows I already hold ids for" join.
    // Treated the same as a bare `{ _id: <ObjectId> }`: the caller must already possess the
    // ids (which came from a row it was itself allowed to read), so it cannot widen tenancy.
    if (!idValue || typeof idValue !== 'object' || Array.isArray(idValue)) {
        return false
    }
    const operators = Object.keys(idValue as Record<string, unknown>)
    if (operators.length !== 1 || operators[0] !== '$in') {
        return false
    }
    const values = (idValue as { $in: unknown }).$in
    return Array.isArray(values) && values.length > 0 && values.every(isObjectIdLike)
}

const isFindByIdFilter = (filter: Record<string, unknown>): boolean => {
    const keys = Object.keys(filter)
    if (keys.length !== 1 || keys[0] !== '_id') {
        return false
    }
    return isObjectIdLike(filter._id) || isIdListLookup(filter._id)
}

/**
 * SEC-60: a sole `{ _id: <string> }` filter whose value is not a valid ObjectId — i.e.
 * `Model.findById('<garbage from a path param>')` on a guarded model. That is malformed client
 * input, not an unscoped-query bug, so `assertQueryIsScoped` reports it as a 400 rather than the
 * 500 the RLS guard would otherwise raise (or the CastError Mongoose would raise on a non-guarded
 * model). The errorMiddleware CastError branch is the backstop for the non-guarded case.
 */
const isMalformedIdFilter = (filter: unknown): boolean => {
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
        return false
    }
    const keys = Object.keys(filter as Record<string, unknown>)
    if (keys.length !== 1 || keys[0] !== '_id') {
        return false
    }
    const value = (filter as Record<string, unknown>)._id
    return typeof value === 'string' && !Types.ObjectId.isValid(value)
}

export const filterHasOwnershipScope = (
    filter: unknown,
    options: RlsPluginOptions = {}
): boolean => {
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
        return false
    }

    const scopedFilter = filter as Record<string, unknown>

    if (isFindByIdFilter(scopedFilter)) {
        return true
    }

    if ('userId' in scopedFilter) {
        return true
    }

    if (options.supportsWorkspace && 'workspaceId' in scopedFilter) {
        return true
    }

    if ('$and' in scopedFilter && Array.isArray(scopedFilter.$and)) {
        return scopedFilter.$and.every(
            (clause) =>
                typeof clause === 'object' &&
                clause !== null &&
                filterHasOwnershipScope(clause, options)
        )
    }

    if ('$or' in scopedFilter && Array.isArray(scopedFilter.$or)) {
        // SEC-63: mirror the plain `workspaceId` branch above — a top-level `workspaceId` is only
        // a tenancy key when the model opts into workspace scoping.
        const hasTopLevelUserScope =
            'userId' in scopedFilter ||
            (options.supportsWorkspace === true && 'workspaceId' in scopedFilter)
        if (hasTopLevelUserScope) {
            return true
        }

        return scopedFilter.$or.every(
            (clause) =>
                typeof clause === 'object' &&
                clause !== null &&
                filterHasOwnershipScope(clause, options)
        )
    }

    return false
}

export const pipelineHasOwnershipScope = (
    pipeline: unknown[],
    options: RlsPluginOptions = {}
): boolean => {
    return pipeline.some((stage) => {
        if (!stage || typeof stage !== 'object' || !('$match' in stage)) {
            return false
        }

        const matchStage = stage as { $match?: unknown }
        return filterHasOwnershipScope(matchStage.$match, options)
    })
}

export const assertQueryIsScoped = (
    filter: unknown,
    options: RlsPluginOptions = {}
): void => {
    if (filterHasOwnershipScope(filter, options)) {
        return
    }
    if (isMalformedIdFilter(filter)) {
        throw new CustomError(ERROR_MESSAGES.GENERAL.INVALID_IDENTIFIER, 400)
    }
    throw new CustomError(ERROR_MESSAGES.GENERAL.UNSCOPED_QUERY, 500)
}

export const assertAggregateIsScoped = (
    pipeline: unknown[],
    options: RlsPluginOptions = {}
): void => {
    if (!pipelineHasOwnershipScope(pipeline, options)) {
        throw new CustomError(ERROR_MESSAGES.GENERAL.UNSCOPED_QUERY, 500)
    }
}

export const pipelineHasCrossCollectionStage = (pipeline: unknown[]): boolean => {
    return pipeline.some(
        (stage) =>
            !!stage &&
            typeof stage === 'object' &&
            CROSS_COLLECTION_STAGES.some(
                (name) => name in (stage as Record<string, unknown>)
            )
    )
}

export const assertAggregateLookupIsReviewed = (pipeline: unknown[]): void => {
    if (pipelineHasCrossCollectionStage(pipeline)) {
        throw new CustomError(ERROR_MESSAGES.GENERAL.UNSCOPED_LOOKUP, 500)
    }
}
