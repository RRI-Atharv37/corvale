import { Types } from 'mongoose'

import type { GrandfatherKind, SubscriptionStatus } from '@core/billing/constants'
import { planMrrMinor } from '@core/billing/metrics'

import AdminAuditLog from './adminAuditLog.model'
import { findPlanPrices, findSubscriptionsByIds } from './adminData.service'
import GrandfatherBatch from './grandfatherBatch.model'

const PAYING_STATUSES: readonly SubscriptionStatus[] = ['active', 'past_due']

export const GRANDFATHER_OUTCOMES = ['free_forever', 'active_grant', 'converted', 'lapsed'] as const
export type GrandfatherOutcome = (typeof GRANDFATHER_OUTCOMES)[number]

export interface GrandfatherOutcomeBucket {
    outcome: GrandfatherOutcome
    count: number
    /** Monthly list-price MRR not collected because these subscriptions hold a grant. Only meaningful for free_forever/active_grant. */
    foregoneMrrMinor: number
}

export interface GrandfatherCohortReport {
    totalEverGrandfathered: number
    buckets: GrandfatherOutcomeBucket[]
}

const classify = (row: { status: SubscriptionStatus; grandfatherKind: GrandfatherKind | null }): GrandfatherOutcome => {
    if (row.grandfatherKind === 'free_forever') return 'free_forever'
    if (row.grandfatherKind !== null) return 'active_grant'
    return PAYING_STATUSES.includes(row.status) ? 'converted' : 'lapsed'
}

/**
 * "Pre-paywall users by outcome" (plan §7 / D13): every subscription a single-user `grandfather.set`
 * audit row or a bulk `GrandfatherBatch` (applied or reverted - a revert doesn't erase the fact someone
 * was once grandfathered) ever touched, classified by *current* state. `foregoneMrrMinor` is the
 * monthly list-price MRR of the still-grandfathered buckets - what they would be paying without the
 * grant, not a historical total.
 */
export const getGrandfatherCohortReport = async (): Promise<GrandfatherCohortReport> => {
    const [auditIds, batches] = await Promise.all([
        AdminAuditLog.distinct('subjectSubscriptionId', { action: 'grandfather.set', subjectSubscriptionId: { $ne: null } }) as Promise<Types.ObjectId[]>,
        GrandfatherBatch.find().select('subscriptionIds').lean<{ subscriptionIds: Types.ObjectId[] }[]>(),
    ])

    const idSet = new Map<string, Types.ObjectId>()
    for (const id of auditIds) idSet.set(id.toString(), id)
    for (const batch of batches) for (const id of batch.subscriptionIds) idSet.set(id.toString(), id)

    const [rows, prices] = await Promise.all([findSubscriptionsByIds([...idSet.values()]), findPlanPrices()])

    const buckets = new Map<GrandfatherOutcome, GrandfatherOutcomeBucket>(
        GRANDFATHER_OUTCOMES.map((outcome) => [outcome, { outcome, count: 0, foregoneMrrMinor: 0 }])
    )

    for (const row of rows) {
        const outcome = classify(row)
        const bucket = buckets.get(outcome) as GrandfatherOutcomeBucket
        bucket.count += 1
        if (outcome === 'free_forever' || outcome === 'active_grant') {
            const planPrices = prices[row.planCode]
            if (planPrices) bucket.foregoneMrrMinor += planMrrMinor(planPrices, row.interval)
        }
    }

    return { totalEverGrandfathered: rows.length, buckets: [...buckets.values()] }
}
