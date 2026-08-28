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
        const hasTopLevelUserScope = 'userId' in scopedFilter || 'workspaceId' in scopedFilter
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
    if (!filterHasOwnershipScope(filter, options)) {
        throw new CustomError(ERROR_MESSAGES.GENERAL.UNSCOPED_QUERY, 500)
    }
}

export const assertAggregateIsScoped = (
    pipeline: unknown[],
    options: RlsPluginOptions = {}
): void => {
    if (!pipelineHasOwnershipScope(pipeline, options)) {
        throw new CustomError(ERROR_MESSAGES.GENERAL.UNSCOPED_QUERY, 500)
    }
}
