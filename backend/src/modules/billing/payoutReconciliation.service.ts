import { RLS_BYPASS } from '@core/access/rowLevelSecurity'

import BillingEvent from './billingEvent.model'
import DeferredRevenueEntry from './deferredRevenueEntry.model'
import Subscription from './subscription.model'

const BYPASS = { [RLS_BYPASS]: true }

export const PERIOD_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export const isValidPeriodMonth = (value: string): boolean => PERIOD_MONTH_PATTERN.test(value)

const monthBoundsUtc = (periodMonth: string): { start: Date; end: Date } => {
    const [year, month] = periodMonth.split('-').map(Number)
    return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) }
}

interface PaymentSucceededPayload {
    providerSubscriptionId?: string
    total?: number
    currency?: string
    refunded?: boolean
}

/**
 * What Corvale separately recognized as revenue for one UTC calendar month, grouped by currency -
 * the M8e annual-plan buckets already written to `DeferredRevenueEntry`, plus monthly-plan payments
 * recognized immediately in the month they were paid (the M8e sweep deliberately skips monthly
 * subscriptions, so they get no `DeferredRevenueEntry` row of their own). Computed at read time
 * rather than stored, so a late-arriving `payment.succeeded` for a past month is picked up the next
 * time this runs instead of requiring a recompute step.
 */
export const computeLocalRevenueByCurrency = async (periodMonth: string): Promise<Record<string, number>> => {
    const totals: Record<string, number> = {}
    const add = (currency: string, amountMinor: number): void => {
        totals[currency] = (totals[currency] ?? 0) + amountMinor
    }

    const buckets = await DeferredRevenueEntry.find({ recognitionMonth: periodMonth })
        .select('currency recognizedAmountMinor')
        .lean()
    for (const bucket of buckets) add(bucket.currency, bucket.recognizedAmountMinor)

    const { start, end } = monthBoundsUtc(periodMonth)
    const payments = await BillingEvent.find({ type: 'payment.succeeded', occurredAt: { $gte: start, $lt: end } })
        .setOptions(BYPASS)
        .lean()

    const candidates: { providerSubscriptionId: string; total: number; currency: string }[] = []
    for (const row of payments) {
        const payload = row.payload as PaymentSucceededPayload
        if (
            payload.refunded ||
            typeof payload.total !== 'number' ||
            payload.total <= 0 ||
            typeof payload.currency !== 'string' ||
            !payload.providerSubscriptionId
        ) {
            continue
        }
        candidates.push({ providerSubscriptionId: payload.providerSubscriptionId, total: payload.total, currency: payload.currency })
    }

    if (candidates.length > 0) {
        const subscriptions = await Subscription.find({ providerSubscriptionId: { $in: candidates.map((c) => c.providerSubscriptionId) } })
            .select('providerSubscriptionId interval')
            .setOptions(BYPASS)
            .lean()
        const intervalBySubscription = new Map(subscriptions.map((s) => [s.providerSubscriptionId, s.interval]))

        for (const candidate of candidates) {
            if (intervalBySubscription.get(candidate.providerSubscriptionId) !== 'monthly') continue
            add(candidate.currency, candidate.total)
        }
    }

    return totals
}
