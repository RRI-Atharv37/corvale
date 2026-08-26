import { Schema, Query } from 'mongoose'

import { SOFT_DELETE_BYPASS } from '../utils/softDelete'

const QUERY_OPERATIONS = [
    'find',
    'findOne',
    'findOneAndUpdate',
    'findOneAndDelete',
    'updateMany',
    'deleteMany',
    'countDocuments',
    'distinct',
] as const

const shouldBypassSoftDelete = (query: Query<unknown, unknown>): boolean => {
    const options = query.getOptions() as Record<string, unknown> | undefined
    return options?.[SOFT_DELETE_BYPASS] === true
}

/**
 * Injects `deletedAt: null` into every read/update filter unless the caller
 * explicitly targets `deletedAt` or opts out via SOFT_DELETE_BYPASS. Modeled
 * on plugins/rowLevelSecurityPlugin.ts, but applied unconditionally (not
 * gated on an AsyncLocalStorage RLS context) since tombstoning must hide
 * soft-deleted rows everywhere, including system/cron code.
 */
export const softDeletePlugin = (schema: Schema): void => {
    schema.add({ deletedAt: { type: Date, default: null } })

    for (const operation of QUERY_OPERATIONS) {
        schema.pre(operation, function (this: Query<unknown, unknown>, next) {
            if (shouldBypassSoftDelete(this)) {
                return next()
            }

            const filter = this.getFilter()
            if (!('deletedAt' in filter)) {
                this.where({ deletedAt: null })
            }
            return next()
        })
    }

    schema.pre('aggregate', function (next) {
        const aggregate = this as unknown as {
            options?: Record<string, unknown>
            pipeline: () => unknown[]
        }
        if (aggregate.options?.[SOFT_DELETE_BYPASS] === true) {
            return next()
        }

        const pipeline = aggregate.pipeline()
        const alreadyFiltered = pipeline.some(
            (stage) =>
                stage &&
                typeof stage === 'object' &&
                '$match' in stage &&
                stage.$match !== null &&
                typeof stage.$match === 'object' &&
                'deletedAt' in (stage.$match as Record<string, unknown>)
        )
        if (!alreadyFiltered) {
            pipeline.unshift({ $match: { deletedAt: null } })
        }
        return next()
    })
}
