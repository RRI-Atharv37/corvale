import { RLS_BYPASS } from '@core/access/rowLevelSecurity'

import BillingEvent from './billingEvent.model'
import DeferredRevenueEntry from './deferredRevenueEntry.model'
import { normalizeCurrency, readLedgerPayment } from './paymentLedger'

const BYPASS = { [RLS_BYPASS]: true }

export const PERIOD_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export const isValidPeriodMonth = (value: string): boolean => PERIOD_MONTH_PATTERN.test(value)

const monthBoundsUtc = (periodMonth: string): { start: Date; end: Date } => {
    const [year, month] = periodMonth.split('-').map(Number)
    return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) }
}

/**
 * What Corvale separately recognized as revenue for one UTC calendar month, grouped by currency -
 * the M8e annual-plan buckets already written to `DeferredRevenueEntry`, plus monthly-plan payments
 * recognized immediately in the month they were paid (the M8e sweep deliberately skips monthly
 * payments, so they get no `DeferredRevenueEntry` row of their own). Currencies are keyed uppercase;
 * rows written before that was enforced are merged in. Computed at read time
 * rather than stored, so a late-arriving `payment.succeeded` for a past month is picked up the next
 * time this runs instead of requiring a recompute step.
 */
export const computeLocalRevenueByCurrency = async (periodMonth: string): Promise<Record<string, number>> => {
    const totals: Record<string, number> = {}
    const add = (currency: string, amountMinor: number): void => {
        const key = normalizeCurrency(currency)
        totals[key] = (totals[key] ?? 0) + amountMinor
    }

    const buckets = await DeferredRevenueEntry.find({ recognitionMonth: periodMonth })
        .select('currency recognizedAmountMinor')
        .lean()
    for (const bucket of buckets) add(bucket.currency, bucket.recognizedAmountMinor)

    const { start, end } = monthBoundsUtc(periodMonth)
    const payments = await BillingEvent.find({ type: 'payment.succeeded', occurredAt: { $gte: start, $lt: end } })
        .setOptions(BYPASS)
        .lean()

    for (const row of payments) {
        const payment = readLedgerPayment(row.payload)
        if (payment?.interval === 'monthly') add(payment.currency, payment.total)
    }

    return totals
}
