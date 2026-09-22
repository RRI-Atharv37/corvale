import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    BillingEvent,
    Subscription,
    handleBillingWebhook,
    recordAndApplyBillingEvent,
    replayBillingEvent,
    resetBillingProvider,
    setBillingProvider,
    type BillingEventOutcome,
    type NormalizedBillingEvent,
} from '@modules/billing'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { BILLING_STATES, setSubscription } from '@tests/billingHelpers'

import { createFakeBillingProvider, FAKE_SIGNATURE_HEADER, signFakePayload } from '../providers/fakeBillingProvider'

/**
 * M3b - the webhook pipeline below the route: verify the raw bytes, parse, write the ledger row,
 * claim it, apply it, settle it. The per-event handlers are M3c; here the applier is injected so
 * the pipeline's own guarantees (record-before-apply, exactly-once under parallel delivery, a
 * retry lease for an event that could not be applied) are pinned independently of them.
 */

const MINUTE_MS = 60 * 1000

let eventCounter = 0
const makeEvent = (overrides: Partial<NormalizedBillingEvent> = {}): NormalizedBillingEvent => {
    eventCounter += 1
    return {
        providerEventId: `evt_service_${eventCounter}`,
        type: 'subscription.updated',
        occurredAt: new Date('2026-09-20T10:00:00.000Z'),
        providerCustomerId: 'cus_1',
        providerSubscriptionId: 'sub_1',
        planCode: 'plus',
        status: 'active',
        ...overrides,
    }
}

const applied: BillingEventOutcome = { status: 'applied' }
const ledger = (providerEventId: string) => BillingEvent.findOne({ providerEventId }).lean()

describe('recordAndApplyBillingEvent', () => {
    it('records the event before applying it, then settles it as processed', async () => {
        const event = makeEvent()
        const seenWhileApplying: Array<{ processedAt: Date | null } | null> = []
        const apply = vi.fn(async () => {
            seenWhileApplying.push(await ledger(event.providerEventId))
            return applied
        })

        const result = await recordAndApplyBillingEvent(event, apply)

        expect(result).toEqual({ duplicate: false })
        expect(seenWhileApplying[0]).toBeTruthy()
        expect(seenWhileApplying[0]?.processedAt ?? null).toBeNull()
        const row = await ledger(event.providerEventId)
        expect(row?.processedAt).toBeTruthy()
        expect(row?.error ?? null).toBeNull()
    })

    it('stores a minimised payload built from the event, never the user id', async () => {
        const event = makeEvent({ userId: '64b000000000000000000001', planCode: 'pro' })

        await recordAndApplyBillingEvent(event, async () => applied)

        const row = await ledger(event.providerEventId)
        expect(row?.payload).toMatchObject({
            providerCustomerId: 'cus_1',
            providerSubscriptionId: 'sub_1',
            planCode: 'pro',
            status: 'active',
        })
        expect(JSON.stringify(row?.payload)).not.toContain('64b000000000000000000001')
    })

    it('a redelivery of a processed event is a duplicate and is not applied again', async () => {
        const event = makeEvent()
        const apply = vi.fn(async () => applied)
        await recordAndApplyBillingEvent(event, apply)

        const again = await recordAndApplyBillingEvent(event, apply)

        expect(again).toEqual({ duplicate: true })
        expect(apply).toHaveBeenCalledTimes(1)
        expect(await BillingEvent.countDocuments({ providerEventId: event.providerEventId })).toBe(1)
    })

    it('an outcome the handler could not apply leaves the row un-processed with the reason', async () => {
        const event = makeEvent()

        const result = await recordAndApplyBillingEvent(event, async () => ({
            status: 'unapplied',
            reason: 'no subscription for this customer',
        }))

        expect(result).toEqual({ duplicate: false })
        const row = await ledger(event.providerEventId)
        expect(row?.processedAt ?? null).toBeNull()
        expect(row?.error).toBe('no subscription for this customer')
    })

    it('an un-applied event is claimed and applied when the same id is redelivered', async () => {
        const event = makeEvent()
        await recordAndApplyBillingEvent(event, async () => ({ status: 'unapplied', reason: 'not yet' }))
        const apply = vi.fn(async () => applied)

        const retry = await recordAndApplyBillingEvent(event, apply)

        expect(retry).toEqual({ duplicate: false })
        expect(apply).toHaveBeenCalledTimes(1)
        const row = await ledger(event.providerEventId)
        expect(row?.processedAt).toBeTruthy()
        expect(row?.error ?? null).toBeNull()
    })

    it('a handler that throws is recorded, the error propagates so the provider retries, and the retry applies it', async () => {
        const event = makeEvent()

        await expect(
            recordAndApplyBillingEvent(event, async () => {
                throw new Error('mongo went away')
            })
        ).rejects.toThrow('mongo went away')

        const failed = await ledger(event.providerEventId)
        expect(failed?.processedAt ?? null).toBeNull()
        expect(failed?.error).toContain('mongo went away')

        const retry = await recordAndApplyBillingEvent(event, async () => applied)
        expect(retry).toEqual({ duplicate: false })
        expect((await ledger(event.providerEventId))?.processedAt).toBeTruthy()
    })

    it('parallel deliveries apply the event exactly once', async () => {
        const event = makeEvent()
        const apply = vi.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, 25))
            return applied
        })

        const results = await Promise.all(
            Array.from({ length: 8 }, () => recordAndApplyBillingEvent(event, apply))
        )

        expect(apply).toHaveBeenCalledTimes(1)
        expect(results.filter((r) => !r.duplicate)).toHaveLength(1)
        expect(await BillingEvent.countDocuments({ providerEventId: event.providerEventId })).toBe(1)
    })

    it('a delivery that arrives while another is mid-apply is a duplicate, not a second apply', async () => {
        const event = makeEvent()
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        const apply = vi.fn(async () => {
            await gate
            return applied
        })

        const first = recordAndApplyBillingEvent(event, apply)
        await vi.waitFor(async () => expect(await ledger(event.providerEventId)).toBeTruthy())
        const second = await recordAndApplyBillingEvent(event, apply)
        release()
        await first

        expect(second).toEqual({ duplicate: true })
        expect(apply).toHaveBeenCalledTimes(1)
    })

    it('an abandoned in-flight claim (crash mid-apply) is retried once its lease has lapsed', async () => {
        const event = makeEvent()
        await BillingEvent.create({
            providerEventId: event.providerEventId,
            type: event.type,
            occurredAt: event.occurredAt,
            payload: {},
        })
        await BillingEvent.collection.updateOne(
            { providerEventId: event.providerEventId },
            { $set: { updatedAt: new Date(Date.now() - 10 * MINUTE_MS) } }
        )
        const apply = vi.fn(async () => applied)

        const result = await recordAndApplyBillingEvent(event, apply)

        expect(result).toEqual({ duplicate: false })
        expect(apply).toHaveBeenCalledTimes(1)
    })

    it('a fresh in-flight claim is not stolen', async () => {
        const event = makeEvent()
        await BillingEvent.create({
            providerEventId: event.providerEventId,
            type: event.type,
            occurredAt: event.occurredAt,
            payload: {},
        })
        const apply = vi.fn(async () => applied)

        const result = await recordAndApplyBillingEvent(event, apply)

        expect(result).toEqual({ duplicate: true })
        expect(apply).not.toHaveBeenCalled()
    })

    it('a mutated redelivery of the same id leaves the recorded payload untouched', async () => {
        const original = makeEvent({ planCode: 'plus' })
        await recordAndApplyBillingEvent(original, async () => applied)

        await recordAndApplyBillingEvent({ ...original, planCode: 'pro' }, async () => applied)

        expect(JSON.stringify((await ledger(original.providerEventId))?.payload)).toContain('"plus"')
    })
})

describe('replayBillingEvent', () => {
    const userId = new Types.ObjectId().toString()

    beforeEach(async () => {
        await setSubscription(userId, { ...BILLING_STATES.active, providerSubscriptionId: 'sub_replay', providerCustomerId: 'cus_replay' })
    })

    const seedUnappliedEvent = (payload: Record<string, unknown>) =>
        BillingEvent.create({
            providerEventId: 'evt_replay_1',
            type: 'subscription.updated',
            occurredAt: new Date('2026-09-20T10:00:00.000Z'),
            payload,
            error: 'earlier failure',
        })

    it('re-applies the reconstructed event, using only what the ledger stored', async () => {
        const event = await seedUnappliedEvent({ providerSubscriptionId: 'sub_replay', status: 'past_due' })

        const outcome = await replayBillingEvent(event._id.toString())

        expect(outcome).toEqual({ status: 'applied' })
        const row = await ledger('evt_replay_1')
        expect(row?.processedAt).toBeTruthy()
        expect(row?.error ?? null).toBeNull()
        expect((await Subscription.findOne({ userId }).lean())?.status).toBe('past_due')
    })

    it('returns null for an unknown id or an event that already processed', async () => {
        const processed = await BillingEvent.create({
            providerEventId: 'evt_replay_done',
            type: 'subscription.updated',
            occurredAt: new Date(),
            payload: {},
            processedAt: new Date(),
        })

        expect(await replayBillingEvent(processed._id.toString())).toBeNull()
        expect(await replayBillingEvent(new Types.ObjectId().toString())).toBeNull()
    })

    it('re-settles with a fresh reason when the reconstructed event still cannot be matched to anything', async () => {
        const event = await seedUnappliedEvent({ providerSubscriptionId: 'sub_gone_from_ledger' })

        const outcome = await replayBillingEvent(event._id.toString())

        expect(outcome).toMatchObject({ status: 'unapplied' })
        const row = await ledger('evt_replay_1')
        expect(row?.processedAt ?? null).toBeNull()
        expect(row?.error).toBeTruthy()
    })

    it('leaves an ordering-superseded replay a no-op, same as any other stale event', async () => {
        await Subscription.updateOne({ userId }, { $set: { lastEventAt: new Date('2026-09-25T00:00:00.000Z') } })
        const event = await seedUnappliedEvent({ providerSubscriptionId: 'sub_replay', status: 'past_due' })

        const outcome = await replayBillingEvent(event._id.toString())

        expect(outcome).toEqual({ status: 'applied' })
        expect((await Subscription.findOne({ userId }).lean())?.status).toBe('active')
    })
})

describe('handleBillingWebhook', () => {
    const wire = (event: NormalizedBillingEvent): string =>
        JSON.stringify({ ...event, occurredAt: event.occurredAt.toISOString() })
    const headers = (raw: string, secret?: string) => ({ [FAKE_SIGNATURE_HEADER]: signFakePayload(raw, secret) })

    beforeEach(() => {
        setBillingProvider(createFakeBillingProvider().provider)
    })
    afterEach(() => {
        resetBillingProvider()
    })

    it('rejects a bad signature with the signature error and records nothing', async () => {
        const raw = wire(makeEvent())

        const attempt = handleBillingWebhook(Buffer.from(raw), headers(raw, 'wrong-secret'))

        await expect(attempt).rejects.toMatchObject({
            statusCode: 400,
            message: ERROR_MESSAGES.BILLING.WEBHOOK_SIGNATURE_INVALID,
        })
        expect(await BillingEvent.countDocuments({})).toBe(0)
    })

    it('rejects an empty body as an invalid signature, never a parse error', async () => {
        await expect(handleBillingWebhook(Buffer.alloc(0), {})).rejects.toBeInstanceOf(CustomError)
        await expect(handleBillingWebhook(Buffer.alloc(0), {})).rejects.toMatchObject({
            message: ERROR_MESSAGES.BILLING.WEBHOOK_SIGNATURE_INVALID,
        })
    })

    it('an event type no handler knows is recorded and settled as processed, changing nothing', async () => {
        const event = makeEvent({ type: 'customer.updated' })
        const raw = wire(event)

        const result = await handleBillingWebhook(Buffer.from(raw), headers(raw))

        expect(result).toEqual({ duplicate: false })
        expect((await ledger(event.providerEventId))?.processedAt).toBeTruthy()
    })

    it('a known event the handlers cannot apply is left un-processed so it is not silently swallowed', async () => {
        const event = makeEvent({ type: 'payment.failed' })
        const raw = wire(event)

        const result = await handleBillingWebhook(Buffer.from(raw), headers(raw))

        expect(result).toEqual({ duplicate: false })
        const row = await ledger(event.providerEventId)
        expect(row?.processedAt ?? null).toBeNull()
        expect(row?.error).toBeTruthy()
    })
})
