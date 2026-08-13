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

export const bypassRls = <T>(fn: () => T | Promise<T>): T | Promise<T> => {
    return fn()
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

const isFindByIdFilter = (filter: Record<string, unknown>): boolean => {
    const keys = Object.keys(filter)
    return keys.length === 1 && keys[0] === '_id' && isObjectIdLike(filter._id)
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
