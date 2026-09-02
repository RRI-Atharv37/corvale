import { Schema, Query } from 'mongoose'

import {
    RLS_ALLOW_LOOKUP,
    RLS_BYPASS,
    RlsPluginOptions,
    assertAggregateIsScoped,
    assertAggregateLookupIsReviewed,
    assertQueryIsScoped,
    isRlsActive,
} from './rowLevelSecurity'

/**
 * Every Mongoose query operation the RLS guard hooks. Kept exported and pinned by
 * `tests/rlsHookedOperations.test.ts` so a future Mongoose upgrade or a casual edit
 * cannot silently drop coverage (SEC-36).
 *
 * `estimatedDocumentCount` takes no filter, so it can never be user-scoped — hooking it
 * means it is *rejected* outright while an RLS context is active. Use `countDocuments`
 * with a `userId`/`workspaceId` filter instead, or the `RLS_BYPASS` option for genuine
 * system-wide counts.
 */
export const QUERY_OPERATIONS = [
    'find',
    'findOne',
    'findOneAndUpdate',
    'findOneAndDelete',
    'findOneAndReplace',
    'updateOne',
    'updateMany',
    'replaceOne',
    'deleteOne',
    'deleteMany',
    'countDocuments',
    'estimatedDocumentCount',
    'distinct',
] as const

const shouldBypassRls = (query: Query<unknown, unknown>): boolean => {
    const options = query.getOptions() as Record<string, unknown> | undefined
    return options?.[RLS_BYPASS] === true
}

export const rowLevelSecurityPlugin = (
    schema: Schema,
    options: RlsPluginOptions = {}
): void => {
    for (const operation of QUERY_OPERATIONS) {
        schema.pre(operation, function (this: Query<unknown, unknown>, next) {
            if (!isRlsActive() || shouldBypassRls(this)) {
                return next()
            }

            try {
                assertQueryIsScoped(this.getFilter(), options)
                return next()
            } catch (error) {
                return next(error as Error)
            }
        })
    }

    schema.pre('aggregate', function (next) {
        if (!isRlsActive()) {
            return next()
        }

        const aggregate = this as unknown as {
            options?: Record<string, unknown>
            pipeline?: () => unknown[]
        }
        if (aggregate.options?.[RLS_BYPASS] === true) {
            return next()
        }

        try {
            const rawPipeline =
                typeof aggregate.pipeline === 'function' ? aggregate.pipeline() : aggregate.pipeline
            const pipeline = Array.isArray(rawPipeline) ? rawPipeline : []
            if (aggregate.options?.[RLS_ALLOW_LOOKUP] !== true) {
                assertAggregateLookupIsReviewed(pipeline)
            }
            assertAggregateIsScoped(pipeline, options)
            return next()
        } catch (error) {
            return next(error as Error)
        }
    })
}
