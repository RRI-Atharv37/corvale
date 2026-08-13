import { Schema, Query } from 'mongoose'

import {
    RLS_BYPASS,
    RlsPluginOptions,
    assertAggregateIsScoped,
    assertQueryIsScoped,
    isRlsActive,
} from '../utils/rowLevelSecurity'

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
            const pipeline =
                typeof aggregate.pipeline === 'function' ? aggregate.pipeline() : aggregate.pipeline
            assertAggregateIsScoped(Array.isArray(pipeline) ? pipeline : [], options)
            return next()
        } catch (error) {
            return next(error as Error)
        }
    })
}
