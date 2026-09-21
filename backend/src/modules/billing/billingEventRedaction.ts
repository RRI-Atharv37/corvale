import { RLS_BYPASS } from '@core/access/rowLevelSecurity'

import BillingEvent, { BILLING_EVENT_REDACTION } from './billingEvent.model'
import Subscription from './subscription.model'

export const LEDGER_ORPHAN_REDACTION_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000
const CHUNK = 500

export interface ProviderIdentifiers {
    providerCustomerId?: string | null
    providerSubscriptionId?: string | null
}

const REDACTION_UPDATE = () => ({
    $unset: { 'payload.providerCustomerId': '', 'payload.providerSubscriptionId': '' },
    $set: { redactedAt: new Date() },
})

// `timestamps: false` keeps `updatedAt`, which anchors the claim lease of an un-applied event.
const REDACTION_OPTIONS = { timestamps: false, [BILLING_EVENT_REDACTION]: true }

/** Removes the provider ids from every ledger row of this customer or subscription; the rest of each row stays. */
export const redactLedgerProviderIds = async ({
    providerCustomerId,
    providerSubscriptionId,
}: ProviderIdentifiers): Promise<number> => {
    const matchers: Record<string, string>[] = []
    if (providerCustomerId) matchers.push({ 'payload.providerCustomerId': providerCustomerId })
    if (providerSubscriptionId) matchers.push({ 'payload.providerSubscriptionId': providerSubscriptionId })
    if (matchers.length === 0) return 0

    const result = await BillingEvent.updateMany({ $or: matchers }, REDACTION_UPDATE()).setOptions(REDACTION_OPTIONS)
    return result.modifiedCount
}

/**
 * An event for a subscription no account owns any more (typically the provider's own
 * `subscription.deleted` arriving after erasure) is never applied, so nothing else would ever
 * scrub it. Young rows are kept: the subscription they belong to may simply not be linked yet.
 */
export const redactOrphanedLedgerProviderIds = async (
    now: Date = new Date(),
    olderThanDays: number = LEDGER_ORPHAN_REDACTION_DAYS
): Promise<number> => {
    const cutoff = new Date(now.getTime() - olderThanDays * DAY_MS)
    const candidates = BillingEvent.find({
        processedAt: null,
        createdAt: { $lt: cutoff },
        $or: [
            { 'payload.providerCustomerId': { $exists: true } },
            { 'payload.providerSubscriptionId': { $exists: true } },
        ],
    })
        .select('payload')
        .lean()
        .cursor()

    let redacted = 0
    let chunk: { _id: unknown; customer?: string; subscription?: string }[] = []

    const flush = async (): Promise<void> => {
        if (chunk.length === 0) return
        const customers = chunk.flatMap((row) => (row.customer ? [row.customer] : []))
        const subscriptions = chunk.flatMap((row) => (row.subscription ? [row.subscription] : []))
        const owners = await Subscription.find({
            $or: [{ providerCustomerId: { $in: customers } }, { providerSubscriptionId: { $in: subscriptions } }],
        })
            .setOptions({ [RLS_BYPASS]: true })
            .select('providerCustomerId providerSubscriptionId')
            .lean()
        const liveCustomers = new Set(owners.map((owner) => owner.providerCustomerId))
        const liveSubscriptions = new Set(owners.map((owner) => owner.providerSubscriptionId))

        const orphanIds = chunk
            .filter(
                (row) =>
                    !(row.customer && liveCustomers.has(row.customer)) &&
                    !(row.subscription && liveSubscriptions.has(row.subscription))
            )
            .map((row) => row._id)

        if (orphanIds.length > 0) {
            const result = await BillingEvent.updateMany({ _id: { $in: orphanIds } }, REDACTION_UPDATE()).setOptions(
                REDACTION_OPTIONS
            )
            redacted += result.modifiedCount
        }
        chunk = []
    }

    for await (const row of candidates) {
        const payload = (row.payload ?? {}) as Record<string, unknown>
        chunk.push({
            _id: row._id,
            customer: typeof payload.providerCustomerId === 'string' ? payload.providerCustomerId : undefined,
            subscription: typeof payload.providerSubscriptionId === 'string' ? payload.providerSubscriptionId : undefined,
        })
        if (chunk.length >= CHUNK) await flush()
    }
    await flush()

    return redacted
}
