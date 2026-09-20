import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import app from '@http/app'
import { BillingEvent, Subscription } from '@modules/billing'
import { registerUser, type RegisteredUser } from '@tests/helpers'
import {
    DAY_MS,
    buildEvent,
    daysFromNow,
    disableBilling,
    enableBilling,
    installFakeBillingProvider,
    postWebhook,
    resetBillingProvider,
    seedTestPlans,
    setSubscription,
    type WireEvent,
} from '@tests/billingHelpers'

/**
 * M1 - webhook replay idempotency (M3b, non-negotiable #2): providers retry, deliver out of
 * order, and deliver in parallel. `BillingEvent.providerEventId` (unique) is the spine: a duplicate
 * is a 200 no-op reported as `duplicate: true`, an event older than the last one applied is
 * ledgered but never regresses state, and an event that could not be applied yet stays
 * un-processed so a later redelivery of the same id gets another go.
 */

let user: RegisteredUser

const ids = () => ({
    providerCustomerId: `cus_${user.userId}`,
    providerSubscriptionId: `sub_${user.userId}`,
})

const at = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString()
const event = (overrides: Partial<WireEvent>) => buildEvent({ ...ids(), ...overrides })
const sub = () => Subscription.findOne({ userId: user.userId }).lean()

beforeEach(async () => {
    enableBilling()
    await seedTestPlans()
    installFakeBillingProvider()
    user = await registerUser(app)
    await setSubscription(user.userId, { status: 'active', planCode: 'pro', ...ids() })
})

afterEach(() => {
    disableBilling()
    resetBillingProvider()
})

describe('webhook replay', () => {
    it('a redelivered event is a 200 no-op flagged duplicate, with one ledger row', async () => {
        const evt = event({ type: 'payment.failed', occurredAt: at(-1000) })

        const first = await postWebhook(app, evt)
        const second = await postWebhook(app, evt)

        expect(first.status).toBe(200)
        expect(first.body.data.duplicate).toBeFalsy()
        expect(second.status).toBe(200)
        expect(second.body.data.duplicate).toBe(true)
        expect(await BillingEvent.countDocuments({ providerEventId: evt.providerEventId })).toBe(1)
    })

    it('replaying an old event cannot undo what happened after it', async () => {
        const failed = event({ type: 'payment.failed', occurredAt: at(-3000) })
        const succeeded = event({ type: 'payment.succeeded', occurredAt: at(-2000), currentPeriodEnd: daysFromNow(30).toISOString() })
        await postWebhook(app, failed)
        await postWebhook(app, succeeded)
        expect((await sub())?.status).toBe('active')

        await postWebhook(app, failed)
        await postWebhook(app, failed)

        const stored = await sub()
        expect(stored?.status).toBe('active')
        expect(stored?.pastDueSince ?? null).toBeNull()
    })

    it('replaying does not double-extend a period', async () => {
        const periodEnd = daysFromNow(30)
        const renewal = event({ type: 'payment.succeeded', occurredAt: at(-1000), currentPeriodEnd: periodEnd.toISOString() })

        await postWebhook(app, renewal)
        await postWebhook(app, renewal)
        await postWebhook(app, renewal)

        expect((await sub())?.currentPeriodEnd?.toISOString()).toBe(periodEnd.toISOString())
    })

    it('the ledger, not the body, decides: a mutated redelivery of the same id changes nothing', async () => {
        const original = event({ type: 'subscription.updated', planCode: 'plus', status: 'active', occurredAt: at(-1000) })
        await postWebhook(app, original)

        const mutated = await postWebhook(app, { ...original, planCode: 'pro' })

        expect(mutated.body.data.duplicate).toBe(true)
        expect((await sub())?.planCode).toBe('plus')
        const ledger = await BillingEvent.findOne({ providerEventId: original.providerEventId }).lean()
        expect(JSON.stringify(ledger?.payload)).toContain('"plus"')
    })

    it('distinct event ids with identical content are both applied - no accidental content de-duplication', async () => {
        const a = event({ type: 'payment.succeeded', occurredAt: at(-2000), currentPeriodEnd: daysFromNow(30).toISOString() })
        const b = event({ type: 'payment.succeeded', occurredAt: at(-1000), currentPeriodEnd: daysFromNow(60).toISOString() })

        await postWebhook(app, a)
        await postWebhook(app, b)

        expect(await BillingEvent.countDocuments({ type: 'payment.succeeded' })).toBe(2)
        expect((await sub())?.currentPeriodEnd?.toISOString()).toBe(b.currentPeriodEnd)
    })

    it('parallel deliveries of one event apply it exactly once', async () => {
        const evt = event({ type: 'subscription.updated', planCode: 'plus', status: 'active', occurredAt: at(-1000) })

        const results = await Promise.all(Array.from({ length: 6 }, () => postWebhook(app, evt)))

        expect(results.every((r) => r.status === 200)).toBe(true)
        expect(results.filter((r) => !r.body.data.duplicate)).toHaveLength(1)
        expect(await BillingEvent.countDocuments({ providerEventId: evt.providerEventId })).toBe(1)
        expect((await sub())?.planCode).toBe('plus')
    })
})

describe('webhook ordering', () => {
    it('an event older than the last applied one is ledgered but does not regress state', async () => {
        const newer = event({ type: 'subscription.updated', planCode: 'plus', status: 'active', occurredAt: at(-1000) })
        const older = event({ type: 'subscription.updated', planCode: 'pro', status: 'active', occurredAt: at(-5000) })

        await postWebhook(app, newer)
        const res = await postWebhook(app, older)

        expect(res.status).toBe(200)
        expect((await sub())?.planCode).toBe('plus')
        expect((await BillingEvent.findOne({ providerEventId: older.providerEventId }).lean())?.processedAt).toBeTruthy()
    })

    it('a delayed cancellation notice cannot cancel a subscription that was renewed after it', async () => {
        const cancelled = event({ type: 'subscription.deleted', status: 'cancelled', occurredAt: at(-DAY_MS) })
        const renewed = event({ type: 'checkout.completed', userId: user.userId, planCode: 'pro', status: 'active', occurredAt: at(-1000), currentPeriodEnd: daysFromNow(30).toISOString() })

        await postWebhook(app, renewed)
        await postWebhook(app, cancelled)

        expect((await sub())?.status).toBe('active')
    })

    it('tracks the newest applied event time on the subscription', async () => {
        const occurredAt = at(-1000)

        await postWebhook(app, event({ type: 'subscription.updated', status: 'active', occurredAt }))

        expect((await sub())?.lastEventAt?.toISOString()).toBe(occurredAt)
    })
})

describe('webhook retry of an event that could not be applied yet', () => {
    it('stays un-processed, and the same id is applied when redelivered once the subscription exists', async () => {
        await Subscription.deleteMany({ userId: user.userId })
        const early = event({ type: 'subscription.updated', planCode: 'plus', status: 'active', occurredAt: at(-1000) })

        const first = await postWebhook(app, early)
        expect(first.status).toBe(200)
        const pending = await BillingEvent.findOne({ providerEventId: early.providerEventId }).lean()
        expect(pending?.processedAt ?? null).toBeNull()
        expect(pending?.error).toBeTruthy()

        await postWebhook(
            app,
            event({ type: 'checkout.completed', userId: user.userId, planCode: 'pro', status: 'active', occurredAt: at(-9000), currentPeriodEnd: daysFromNow(30).toISOString() })
        )
        const retry = await postWebhook(app, early)

        expect(retry.status).toBe(200)
        expect(retry.body.data.duplicate).toBeFalsy()
        expect((await sub())?.planCode).toBe('plus')
        const settled = await BillingEvent.findOne({ providerEventId: early.providerEventId }).lean()
        expect(settled?.processedAt).toBeTruthy()
        expect(await BillingEvent.countDocuments({ providerEventId: early.providerEventId })).toBe(1)
    })
})
