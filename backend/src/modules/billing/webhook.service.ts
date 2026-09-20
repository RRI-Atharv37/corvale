import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { isDuplicateKeyError } from '@core/db/objectId'
import { logger } from '@infra/observability/logger'

import BillingEvent from './billingEvent.model'
import { getBillingProvider } from './providers/providerRegistry'
import type { NormalizedBillingEvent, WebhookHeaders } from './providers/billingProvider'
import { applyBillingEvent, type BillingEventHandler } from './webhookEventHandlers'

export interface WebhookResult {
    duplicate: boolean
}

/** How long a claimed-but-unsettled ledger row is presumed to belong to a live delivery before another may retry it. */
const CLAIM_LEASE_MS = 5 * 60 * 1000
const MAX_ERROR_LENGTH = 500

const compact = (source: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined))

// The user id is left out on purpose: the ledger is append-only and outlives account erasure.
const buildLedgerPayload = (event: NormalizedBillingEvent): Record<string, unknown> =>
    compact({
        providerCustomerId: event.providerCustomerId,
        providerSubscriptionId: event.providerSubscriptionId,
        planCode: event.planCode,
        status: event.status,
        currentPeriodEnd: event.currentPeriodEnd,
        trialEndsAt: event.trialEndsAt,
        cancelAtPeriodEnd: event.cancelAtPeriodEnd,
        ...event.payload,
    })

const claimForRetry = async (providerEventId: string): Promise<boolean> => {
    const leaseCutoff = new Date(Date.now() - CLAIM_LEASE_MS)
    const claimed = await BillingEvent.findOneAndUpdate(
        {
            providerEventId,
            processedAt: null,
            $or: [{ error: { $ne: null } }, { updatedAt: { $lt: leaseCutoff } }],
        },
        { $set: { error: null } }
    )
    return claimed !== null
}

const settle = async (providerEventId: string, fields: { processedAt?: Date; error: string | null }): Promise<void> => {
    await BillingEvent.updateOne({ providerEventId }, { $set: fields })
}

const truncate = (message: string): string => message.slice(0, MAX_ERROR_LENGTH)

/**
 * Ledger first, then apply: the unique `providerEventId` row is the exactly-once spine. Whoever
 * inserts it (or later claims an un-applied one) applies the event; every other delivery of the
 * same id is a duplicate no-op.
 */
export const recordAndApplyBillingEvent = async (
    event: NormalizedBillingEvent,
    apply: BillingEventHandler = applyBillingEvent
): Promise<WebhookResult> => {
    try {
        await BillingEvent.create({
            providerEventId: event.providerEventId,
            type: event.type,
            occurredAt: event.occurredAt,
            payload: buildLedgerPayload(event),
        })
    } catch (error) {
        if (!isDuplicateKeyError(error)) throw error
        if (!(await claimForRetry(event.providerEventId))) return { duplicate: true }
    }

    try {
        const outcome = await apply(event)
        if (outcome.status === 'applied') {
            await settle(event.providerEventId, { processedAt: new Date(), error: null })
        } else {
            logger.warn('Billing event not applied', { type: event.type, reason: outcome.reason })
            await settle(event.providerEventId, { error: truncate(outcome.reason) })
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error applying billing event'
        logger.error('Billing event failed to apply', { type: event.type, reason: message })
        await settle(event.providerEventId, { error: truncate(message) }).catch(() => undefined)
        throw error
    }

    return { duplicate: false }
}

/** Signature is checked over the raw bytes before anything is parsed; nothing is recorded on a failure. */
export const handleBillingWebhook = async (rawBody: Buffer, headers: WebhookHeaders): Promise<WebhookResult> => {
    const provider = getBillingProvider()

    if (!provider.verifyWebhook(rawBody, headers)) {
        throw new CustomError(ERROR_MESSAGES.BILLING.WEBHOOK_SIGNATURE_INVALID, 400)
    }

    return recordAndApplyBillingEvent(provider.parseEvent(rawBody))
}
