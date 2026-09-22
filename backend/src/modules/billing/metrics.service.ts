import { RLS_BYPASS } from '@core/access/rowLevelSecurity'
import type { PlanCode, SubscriptionStatus } from '@core/billing/constants'
import { calculateMrr, dateKeyUtc, planMrrMinor, type MetricFlowField, type MetricFlows, type MetricStockSegment, type PlanPrices } from '@core/billing/metrics'
import { logger } from '@infra/observability/logger'

import BillingEvent from './billingEvent.model'
import MetricDaily from './metricDaily.model'
import Plan from './plan.model'
import type { BillingInterval } from './providers/billingProvider'
import Subscription, { type ISubscription } from './subscription.model'

const BYPASS = { [RLS_BYPASS]: true }

/** One same-day `$inc`, upserting the day's doc. A late event that lands on an already-closed day is still counted, and stamps `flowRevisedAt` so the dashboard can flag it (D13). */
export const recordMetric = async (field: MetricFlowField, amount: number, at: Date = new Date()): Promise<void> => {
    if (amount === 0) return
    const date = dateKeyUtc(at)

    const doc = await MetricDaily.findOneAndUpdate({ date }, { $inc: { [`flows.${field}`]: amount } }, { upsert: true, new: true })
    if (doc?.closed) await MetricDaily.updateOne({ date }, { $set: { flowRevisedAt: new Date() } })
}

/** Guards a billing-event-driven metric write against a redelivery of the same event: only the first claim increments anything. */
export const claimMetricsOnce = async (providerEventId: string): Promise<boolean> => {
    const claimed = await BillingEvent.findOneAndUpdate({ providerEventId, metricsRecordedAt: null }, { $set: { metricsRecordedAt: new Date() } })
    return claimed !== null
}

export const recordTransitionMetrics = async (providerEventId: string, occurredAt: Date, metrics: Partial<MetricFlows>): Promise<void> => {
    const entries = Object.entries(metrics).filter(([, amount]) => amount) as [MetricFlowField, number][]
    if (entries.length === 0) return
    if (!(await claimMetricsOnce(providerEventId))) return

    for (const [field, amount] of entries) await recordMetric(field, amount, occurredAt)
}

const planPricesCache = new Map<PlanCode, PlanPrices>()

const fetchPlanPrices = async (planCode: PlanCode): Promise<PlanPrices> => {
    const cached = planPricesCache.get(planCode)
    if (cached) return cached

    const plan = await Plan.findOne({ code: planCode }).select('prices').lean()
    const prices: PlanPrices = plan ? plan.prices : { monthly: null, annual: null }
    planPricesCache.set(planCode, prices)
    return prices
}

/** Cleared between test cases and whenever a plan's price might have changed; production prices are effectively static. */
export const clearPlanPricesCache = (): void => planPricesCache.clear()

const LIVE_STATUSES: readonly SubscriptionStatus[] = ['active', 'past_due']

/**
 * Derives the flow counters one subscription transition produced, then records them guarded by the
 * event's own idempotency claim. Never throws into the caller: a metrics bug must not fail webhook
 * processing (and trigger a provider retry storm) - it is logged and swallowed instead.
 *
 * Deliberately simplified against the plan's full spec (§7): `newPaid`/`trialConverted` fire on the
 * first transition into `active`/`past_due`; involuntary vs voluntary churn is read straight off
 * `cancelAtPeriodEnd` at the moment of cancellation, not re-derived from history.
 */
interface SubscriptionChanges {
    status?: SubscriptionStatus
    planCode?: PlanCode
    interval?: BillingInterval | null
}

export const recordSubscriptionTransitionMetrics = async (
    before: ISubscription | null,
    changes: Record<string, unknown>,
    providerEventId: string,
    occurredAt: Date
): Promise<void> => {
    const after = changes as SubscriptionChanges
    try {
        const oldStatus = before?.status
        const newStatus = after.status ?? oldStatus
        const wasLive = oldStatus !== undefined && LIVE_STATUSES.includes(oldStatus)
        const isLive = newStatus !== undefined && LIVE_STATUSES.includes(newStatus)
        const metrics: Partial<MetricFlows> = {}

        if (isLive && !wasLive) {
            metrics.newPaid = 1
            if (oldStatus === 'trialing') metrics.trialConverted = 1
            const planCode = after.planCode ?? before?.planCode
            if (planCode) metrics.newMrr = planMrrMinor(await fetchPlanPrices(planCode), after.interval ?? before?.interval ?? null)
        } else if (isLive && wasLive && before) {
            const oldPlanCode = before.planCode
            const newPlanCode = after.planCode ?? oldPlanCode
            const newInterval = after.interval !== undefined ? after.interval : before.interval
            const oldMrr = planMrrMinor(await fetchPlanPrices(oldPlanCode), before.interval)
            const newMrr = planMrrMinor(await fetchPlanPrices(newPlanCode), newInterval)
            if (newMrr > oldMrr) metrics.expansionMrr = newMrr - oldMrr
            else if (newMrr < oldMrr) metrics.contractionMrr = oldMrr - newMrr
        }

        if (newStatus === 'cancelled' && wasLive && before) {
            metrics[before.cancelAtPeriodEnd ? 'churnedVoluntary' : 'churnedInvoluntary'] = 1
            metrics.churnedMrr = planMrrMinor(await fetchPlanPrices(before.planCode), before.interval)
        }
        if (newStatus === 'past_due' && oldStatus !== 'past_due') metrics.pastDueEntered = 1
        if (oldStatus === 'past_due' && newStatus === 'active') metrics.dunningRecovered = 1

        await recordTransitionMetrics(providerEventId, occurredAt, metrics)
    } catch (error) {
        logger.error('Failed to record subscription transition metrics', { reason: (error as Error).message })
    }
}

// -------- M7b.2: stock snapshot --------

/**
 * Groups every `Subscription` row by plan/status/interval/grandfatherKind, excluding an actively
 * comped/overridden row from the count the same way MRR must exclude it (an admin grant is not a sale).
 * One aggregation, in `modules/billing` - the admin module's cross-collection-aggregation ban does not
 * apply here, this is the module that owns `Subscription`.
 */
export const computeStockSegments = async (now: Date): Promise<MetricStockSegment[]> => {
    const rows = await Subscription.aggregate([
        { $match: { $or: [{ adminGrant: null }, { 'adminGrant.until': { $lte: now } }] } },
        {
            $group: {
                _id: { planCode: '$planCode', status: '$status', interval: '$interval', grandfatherKind: '$grandfatherKind' },
                count: { $sum: 1 },
            },
        },
    ]).option(BYPASS)

    return rows.map((row: { _id: { planCode: PlanCode; status: SubscriptionStatus; interval: BillingInterval | null; grandfatherKind: string | null }; count: number }) => ({
        planCode: row._id.planCode,
        status: row._id.status,
        interval: row._id.interval ?? null,
        grandfatherKind: (row._id.grandfatherKind ?? null) as MetricStockSegment['grandfatherKind'],
        count: row.count,
    }))
}

/**
 * A point-in-time reading, written onto *today's* UTC-day doc - it is never rewound (D13). Also closes
 * every earlier day that is not yet closed, without touching its stock: the last write before that day's
 * midnight is its close, so a run that was down for a few days still closes each day off its own
 * last-known reading, never backfilled with today's numbers. Added as the last step of `runBillingSweeps`
 * (M7b.2), so there is no new cron.
 */
export const snapshotMetricsStock = async (now: Date = new Date()): Promise<void> => {
    const today = dateKeyUtc(now)
    const segments = await computeStockSegments(now)
    const plans = await Plan.find().select('code prices').lean()
    const prices = Object.fromEntries(plans.map((plan) => [plan.code, plan.prices]))
    const { listPriceMrrMinor, atRiskMrrMinor } = calculateMrr(segments, prices)

    await MetricDaily.updateOne({ date: today }, { $set: { stock: { asOf: now, segments, listPriceMrrMinor, atRiskMrrMinor } } }, { upsert: true })
    await MetricDaily.updateMany({ date: { $lt: today }, closed: false }, { $set: { closed: true } })
}
