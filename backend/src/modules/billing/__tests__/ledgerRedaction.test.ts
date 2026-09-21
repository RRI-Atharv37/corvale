import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
    BillingEvent,
    Subscription,
    redactLedgerProviderIds,
    redactOrphanedLedgerProviderIds,
    runBillingSweeps,
} from '@modules/billing'
import { DAY_MS, disableBilling, enableBilling } from '@tests/billingHelpers'

/**
 * M7.0 (D11) - provider customer/subscription ids are personal data: the MoR resolves them to a
 * named person. The ledger is append-only, so it used to keep them after the account was erased.
 * The only sanctioned exception to "append-only" is this redaction; everything else about a
 * recorded event (type, time, amounts, plan) stays so metrics and reconciliation are unaffected.
 */

const NOW = new Date('2026-10-10T12:00:00.000Z')

let eventCounter = 0
const seedEvent = async (
    payload: Record<string, unknown>,
    fields: { processedAt?: Date | null; createdAt?: Date } = {}
) => {
    eventCounter += 1
    const doc = await BillingEvent.create({
        providerEventId: `evt_redact_${eventCounter}`,
        type: 'payment.succeeded',
        occurredAt: new Date('2026-10-01T00:00:00.000Z'),
        payload,
        processedAt: fields.processedAt ?? null,
    })
    if (fields.createdAt) {
        await BillingEvent.collection.updateOne({ _id: doc._id }, { $set: { createdAt: fields.createdAt } })
    }
    return doc._id
}

const load = async (id: Types.ObjectId) => BillingEvent.findById(id).lean()

beforeEach(() => enableBilling())
afterEach(() => disableBilling())

describe('redactLedgerProviderIds', () => {
    it('removes both provider ids from every row of that customer or subscription, and nothing else', async () => {
        const bySub = await seedEvent({ providerSubscriptionId: 'sub_a', providerCustomerId: 'cus_a', total: 600, currency: 'USD', variantId: 'v1', planCode: 'plus' })
        const byCustomerOnly = await seedEvent({ providerCustomerId: 'cus_a', total: 600, currency: 'USD' })
        const bySubOnly = await seedEvent({ providerSubscriptionId: 'sub_a', total: 600 })

        const count = await redactLedgerProviderIds({ providerCustomerId: 'cus_a', providerSubscriptionId: 'sub_a' })

        expect(count).toBe(3)
        const row = await load(bySub)
        expect(row?.payload).toEqual({ total: 600, currency: 'USD', variantId: 'v1', planCode: 'plus' })
        expect(row?.type).toBe('payment.succeeded')
        expect(row?.occurredAt.toISOString()).toBe('2026-10-01T00:00:00.000Z')
        expect(row?.redactedAt).toBeInstanceOf(Date)
        expect((await load(byCustomerOnly))?.payload).toEqual({ total: 600, currency: 'USD' })
        expect((await load(bySubOnly))?.payload).toEqual({ total: 600 })
    })

    it('leaves other customers untouched', async () => {
        const mine = await seedEvent({ providerSubscriptionId: 'sub_a', providerCustomerId: 'cus_a' })
        const theirs = await seedEvent({ providerSubscriptionId: 'sub_b', providerCustomerId: 'cus_b' })

        await redactLedgerProviderIds({ providerCustomerId: 'cus_a', providerSubscriptionId: 'sub_a' })

        expect((await load(mine))?.payload).toEqual({})
        expect((await load(theirs))?.payload).toEqual({ providerSubscriptionId: 'sub_b', providerCustomerId: 'cus_b' })
        expect((await load(theirs))?.redactedAt ?? null).toBeNull()
    })

    it('matches on whichever id is supplied', async () => {
        const id = await seedEvent({ providerSubscriptionId: 'sub_only', providerCustomerId: 'cus_other' })

        expect(await redactLedgerProviderIds({ providerSubscriptionId: 'sub_only' })).toBe(1)
        expect((await load(id))?.payload).toEqual({})
    })

    it('does nothing when no id is given - rows without ids must not match', async () => {
        const noIds = await seedEvent({ total: 100 })
        const withIds = await seedEvent({ providerSubscriptionId: 'sub_a' })

        expect(await redactLedgerProviderIds({})).toBe(0)
        expect(await redactLedgerProviderIds({ providerCustomerId: null, providerSubscriptionId: null })).toBe(0)

        expect((await load(noIds))?.redactedAt ?? null).toBeNull()
        expect((await load(withIds))?.payload).toEqual({ providerSubscriptionId: 'sub_a' })
    })

    it('is idempotent', async () => {
        await seedEvent({ providerSubscriptionId: 'sub_a' })

        expect(await redactLedgerProviderIds({ providerSubscriptionId: 'sub_a' })).toBe(1)
        expect(await redactLedgerProviderIds({ providerSubscriptionId: 'sub_a' })).toBe(0)
    })

    it('does not loosen the append-only guarantee for anything else', async () => {
        const id = await seedEvent({ providerSubscriptionId: 'sub_a', total: 600 })

        await expect(
            BillingEvent.updateOne({ _id: id }, { $unset: { 'payload.providerSubscriptionId': 1 } })
        ).rejects.toThrow(/append-only/)
        await expect(BillingEvent.updateOne({ _id: id }, { $set: { 'payload.total': 1 } })).rejects.toThrow(/append-only/)
        await expect(BillingEvent.deleteOne({ _id: id })).rejects.toThrow(/append-only/)
    })
})

describe('redactOrphanedLedgerProviderIds', () => {
    const cutoffDays = 30

    it('scrubs ids from an unprocessed event no subscription claims, once it is old enough', async () => {
        const old = await seedEvent(
            { providerSubscriptionId: 'sub_gone', providerCustomerId: 'cus_gone', total: 600 },
            { createdAt: new Date(NOW.getTime() - 31 * DAY_MS) }
        )

        const count = await redactOrphanedLedgerProviderIds(NOW, cutoffDays)

        expect(count).toBe(1)
        expect((await load(old))?.payload).toEqual({ total: 600 })
        expect((await load(old))?.redactedAt).toBeInstanceOf(Date)
    })

    it('keeps a young orphan: the subscription it belongs to may simply not be linked yet', async () => {
        const young = await seedEvent(
            { providerSubscriptionId: 'sub_soon' },
            { createdAt: new Date(NOW.getTime() - 5 * DAY_MS) }
        )

        expect(await redactOrphanedLedgerProviderIds(NOW, cutoffDays)).toBe(0)
        expect((await load(young))?.payload).toEqual({ providerSubscriptionId: 'sub_soon' })
    })

    it('keeps an old event whose ids a live subscription still owns', async () => {
        await Subscription.create({
            userId: new Types.ObjectId(),
            planCode: 'pro',
            status: 'active',
            providerCustomerId: 'cus_live',
            providerSubscriptionId: 'sub_live',
        })
        const linked = await seedEvent(
            { providerSubscriptionId: 'sub_live', providerCustomerId: 'cus_live' },
            { createdAt: new Date(NOW.getTime() - 90 * DAY_MS) }
        )

        expect(await redactOrphanedLedgerProviderIds(NOW, cutoffDays)).toBe(0)
        expect((await load(linked))?.payload).toEqual({ providerSubscriptionId: 'sub_live', providerCustomerId: 'cus_live' })
    })

    it('leaves applied events alone; their subscription is redacted at erasure instead', async () => {
        const applied = await seedEvent(
            { providerSubscriptionId: 'sub_applied' },
            { processedAt: new Date('2026-09-01T00:00:00.000Z'), createdAt: new Date(NOW.getTime() - 90 * DAY_MS) }
        )

        expect(await redactOrphanedLedgerProviderIds(NOW, cutoffDays)).toBe(0)
        expect((await load(applied))?.payload).toEqual({ providerSubscriptionId: 'sub_applied' })
    })

    it('runs as part of the billing sweep and reports the count', async () => {
        await seedEvent({ providerSubscriptionId: 'sub_gone' }, { createdAt: new Date(NOW.getTime() - 40 * DAY_MS) })

        const result = await runBillingSweeps(NOW)

        expect(result.ledgerRedacted).toBe(1)
    })

    it('still runs while billing is off: data hygiene does not depend on billing state', async () => {
        disableBilling()
        await seedEvent({ providerSubscriptionId: 'sub_gone' }, { createdAt: new Date(NOW.getTime() - 40 * DAY_MS) })

        const result = await runBillingSweeps(NOW)

        expect(result.skipped).toBe(true)
        expect(result.ledgerRedacted).toBe(1)
    })
})
