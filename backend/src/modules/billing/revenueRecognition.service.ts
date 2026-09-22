import { RLS_BYPASS } from '@core/access/rowLevelSecurity'
import { splitIntoMonthlyBuckets } from '@core/billing/revenueRecognition'
import { isDuplicateKeyError } from '@core/db/objectId'
import { logger } from '@infra/observability/logger'

import BillingEvent from './billingEvent.model'
import DeferredRevenueEntry from './deferredRevenueEntry.model'
import { isFinanceOpsEnabled } from './financeOpsConfig'
import Subscription from './subscription.model'

const BYPASS = { [RLS_BYPASS]: true }

export interface RevenueRecognitionSweepResult {
    skipped: boolean
    /** Payment events this run took the once-only claim on (whether or not they produced entries). */
    claimed: number
    entriesCreated: number
}

/** Guards a recognition write against a redelivery of the same payment event - the `claimMetricsOnce` (M7b) shape, reused. */
const claimRevenueRecognitionOnce = async (providerEventId: string): Promise<boolean> => {
    const claimed = await BillingEvent.findOneAndUpdate(
        { providerEventId, revenueRecognizedAt: null },
        { $set: { revenueRecognizedAt: new Date() } }
    )
    return claimed !== null
}

interface PaymentSucceededPayload {
    providerSubscriptionId?: string
    total?: number
    currency?: string
    refunded?: boolean
}

/**
 * Reads every un-recognized `payment.succeeded` row off the append-only billing ledger, keeps the
 * ones that belong to a currently-annual subscription and were not refunded, and splits each into
 * 12 monthly `DeferredRevenueEntry` rows.
 *
 * Deliberately decoupled from `webhookEventHandlers.ts` (M8e design decision): this reads
 * `BillingEvent` after the fact rather than hooking the live `handlePaymentSucceeded` path, so a
 * bug in bookkeeping math can never affect entitlement application. Off by default behind
 * `FINANCE_OPS_ENABLED`; even while off nothing here claims an event, so enabling it later still
 * picks up everything that arrived while it was off.
 */
export const runRevenueRecognitionSweep = async (): Promise<RevenueRecognitionSweepResult> => {
    if (!isFinanceOpsEnabled()) return { skipped: true, claimed: 0, entriesCreated: 0 }

    const candidates = await BillingEvent.find({ type: 'payment.succeeded', revenueRecognizedAt: null })
        .setOptions(BYPASS)
        .lean()

    let claimed = 0
    let entriesCreated = 0

    for (const row of candidates) {
        if (!(await claimRevenueRecognitionOnce(row.providerEventId))) continue
        claimed += 1

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

        const subscription = await Subscription.findOne({ providerSubscriptionId: payload.providerSubscriptionId })
            .select('interval planCode')
            .setOptions(BYPASS)
            .lean()
        if (!subscription || subscription.interval !== 'annual') continue

        const buckets = splitIntoMonthlyBuckets(payload.total, row.occurredAt)
        try {
            await DeferredRevenueEntry.insertMany(
                buckets.map((bucket) => ({
                    sourceEventId: row.providerEventId,
                    providerSubscriptionId: payload.providerSubscriptionId,
                    planCode: subscription.planCode,
                    bucketIndex: bucket.bucketIndex,
                    recognitionMonth: bucket.recognitionMonth,
                    recognizedAmountMinor: bucket.amountMinor,
                    currency: payload.currency,
                    paymentOccurredAt: row.occurredAt,
                })),
                { ordered: true }
            )
            entriesCreated += buckets.length
        } catch (error) {
            if (!isDuplicateKeyError(error)) throw error
            logger.warn('Revenue recognition entries already existed for a claimed event', { providerEventId: row.providerEventId })
        }
    }

    return { skipped: false, claimed, entriesCreated }
}
