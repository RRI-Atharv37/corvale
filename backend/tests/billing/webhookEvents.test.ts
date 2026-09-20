import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { BillingEvent, Subscription } from '@modules/billing'
import { authHeader, registerUser, type RegisteredUser } from '@tests/helpers'
import {
    BILLING_STATES,
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
 * M1 - what each verified provider event does to entitlement (M3c). Entitlement changes ONLY here,
 * on a signed webhook - never on a client success redirect (M3b #4). Events reach the handler
 * already normalised by the provider adapter (`NormalizedBillingEvent`), so these assertions hold
 * for any Merchant of Record. Anything the handler cannot apply is acknowledged (200, so the
 * provider stops retrying), recorded on the ledger with an `error`, and changes nothing.
 */

let user: RegisteredUser

const ids = () => ({
    providerCustomerId: `cus_${user.userId}`,
    providerSubscriptionId: `sub_${user.userId}`,
})

const send = (overrides: Partial<WireEvent>) => postWebhook(app, buildEvent({ ...ids(), ...overrides }))

const sub = () => Subscription.findOne({ userId: user.userId }).lean()

const canWrite = async (): Promise<boolean> => {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(user.token))
        .send({ name: `probe-${Date.now()}-${Math.random()}`, type: 'checking', openingBalance: 1 })
    return res.status === 201
}

beforeEach(async () => {
    enableBilling()
    await seedTestPlans()
    installFakeBillingProvider()
    user = await registerUser(app)
})

afterEach(() => {
    disableBilling()
    resetBillingProvider()
})

describe('checkout.completed / subscription.created', () => {
    it('turns an expired trial into an active paid subscription on the purchased plan', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.trial_expired, providerCustomerId: null, providerSubscriptionId: null })
        expect(await canWrite()).toBe(false)
        const periodEnd = daysFromNow(30).toISOString()

        const res = await postWebhook(
            app,
            buildEvent({
                type: 'checkout.completed',
                userId: user.userId,
                ...ids(),
                planCode: 'plus',
                status: 'active',
                currentPeriodEnd: periodEnd,
            })
        )

        expect(res.status).toBe(200)
        const stored = await sub()
        expect(stored?.status).toBe('active')
        expect(stored?.planCode).toBe('plus')
        expect(stored?.providerCustomerId).toBe(ids().providerCustomerId)
        expect(stored?.providerSubscriptionId).toBe(ids().providerSubscriptionId)
        expect(stored?.currentPeriodEnd?.toISOString()).toBe(periodEnd)
        expect(await canWrite()).toBe(true)
    })

    it('subscription.created is handled the same way', async () => {
        await setSubscription(user.userId, BILLING_STATES.trialing)

        await postWebhook(
            app,
            buildEvent({ type: 'subscription.created', userId: user.userId, ...ids(), planCode: 'pro', status: 'active', currentPeriodEnd: daysFromNow(30).toISOString() })
        )

        const stored = await sub()
        expect(stored?.status).toBe('active')
        expect(stored?.planCode).toBe('pro')
    })

    it('creates the subscription row when a signup somehow has none', async () => {
        await Subscription.deleteMany({ userId: user.userId })

        await postWebhook(
            app,
            buildEvent({ type: 'checkout.completed', userId: user.userId, ...ids(), planCode: 'plus', status: 'active', currentPeriodEnd: daysFromNow(30).toISOString() })
        )

        expect((await sub())?.status).toBe('active')
    })
})

describe('subscription.updated', () => {
    beforeEach(() => setSubscription(user.userId, { planCode: 'pro', status: 'active', ...ids() }))

    it('applies a plan change (downgrade) and the new period end', async () => {
        const periodEnd = daysFromNow(60).toISOString()

        await send({ type: 'subscription.updated', planCode: 'plus', status: 'active', currentPeriodEnd: periodEnd })

        const stored = await sub()
        expect(stored?.planCode).toBe('plus')
        expect(stored?.currentPeriodEnd?.toISOString()).toBe(periodEnd)
    })

    it('records a scheduled cancellation: still writable until the period ends', async () => {
        await send({ type: 'subscription.updated', status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: daysFromNow(10).toISOString() })

        expect((await sub())?.cancelAtPeriodEnd).toBe(true)
        expect(await canWrite()).toBe(true)
    })

    it('finds the subscription by customer id alone when the subscription id is absent', async () => {
        await send({ type: 'subscription.updated', providerSubscriptionId: undefined, planCode: 'plus', status: 'active' })

        expect((await sub())?.planCode).toBe('plus')
    })
})

describe('subscription.deleted', () => {
    it('cancels: the account becomes read-only and its data stays', async () => {
        await setSubscription(user.userId, { status: 'active', ...ids() })
        await request(app).post('/api/v1/accounts').set(authHeader(user.token)).send({ name: 'Keep me', type: 'checking', openingBalance: 1 })

        await send({ type: 'subscription.deleted', status: 'cancelled' })

        expect((await sub())?.status).toBe('cancelled')
        expect(await canWrite()).toBe(false)
        const list = await request(app).get('/api/v1/accounts').set(authHeader(user.token))
        expect(JSON.stringify(list.body)).toContain('Keep me')
    })
})

describe('payment.failed / payment.succeeded (dunning)', () => {
    beforeEach(() => setSubscription(user.userId, { status: 'active', ...ids() }))

    it('payment.failed moves to past_due - still writable inside the grace window', async () => {
        const occurredAt = new Date().toISOString()

        await send({ type: 'payment.failed', occurredAt })

        const stored = await sub()
        expect(stored?.status).toBe('past_due')
        expect(stored?.pastDueSince?.toISOString()).toBe(occurredAt)
        expect(await canWrite()).toBe(true)
    })

    it('repeated payment.failed retries do not restart the grace clock', async () => {
        const first = new Date(Date.now() - 3 * DAY_MS).toISOString()
        await send({ type: 'payment.failed', occurredAt: first })

        await send({ type: 'payment.failed', occurredAt: new Date().toISOString() })

        expect((await sub())?.pastDueSince?.toISOString()).toBe(first)
    })

    it('payment.succeeded recovers to active, clears the dunning clock and extends the period', async () => {
        await send({ type: 'payment.failed', occurredAt: new Date(Date.now() - 2 * DAY_MS).toISOString() })
        const periodEnd = daysFromNow(30).toISOString()

        await send({ type: 'payment.succeeded', currentPeriodEnd: periodEnd })

        const stored = await sub()
        expect(stored?.status).toBe('active')
        expect(stored?.pastDueSince ?? null).toBeNull()
        expect(stored?.currentPeriodEnd?.toISOString()).toBe(periodEnd)
    })

    it('a past_due subscription whose grace has long elapsed is read-only until payment succeeds', async () => {
        await send({ type: 'payment.failed', occurredAt: new Date(Date.now() - 90 * DAY_MS).toISOString() })
        expect(await canWrite()).toBe(false)

        await send({ type: 'payment.succeeded', currentPeriodEnd: daysFromNow(30).toISOString() })

        expect(await canWrite()).toBe(true)
    })
})

describe('refund.issued / dispute.opened', () => {
    it.each(['refund.issued', 'dispute.opened'] as const)('%s is recorded and acknowledged without altering entitlement', async (type) => {
        await setSubscription(user.userId, { status: 'active', ...ids() })

        const res = await send({ type })

        expect(res.status).toBe(200)
        const ledger = await BillingEvent.findOne({ type }).lean()
        expect(ledger?.processedAt).toBeTruthy()
        expect((await sub())?.status).toBe('active')
    })
})

describe('events the handler cannot or should not apply', () => {
    beforeEach(() => setSubscription(user.userId, { ...BILLING_STATES.trialing, ...ids() }))

    const unchanged = async () => {
        const stored = await sub()
        expect(stored?.status).toBe('trialing')
        expect(stored?.planCode).toBe('pro')
    }

    it('an unknown event type is acknowledged and recorded, changing nothing', async () => {
        const res = await send({ type: 'customer.updated' as WireEvent['type'] })

        expect(res.status).toBe(200)
        expect((await BillingEvent.findOne({ type: 'customer.updated' }).lean())?.processedAt).toBeTruthy()
        await unchanged()
    })

    it('an event for a subscription we do not know is acknowledged, ledgered with an error, and creates nothing', async () => {
        const res = await postWebhook(
            app,
            buildEvent({ type: 'subscription.updated', providerCustomerId: 'cus_stranger', providerSubscriptionId: 'sub_stranger', planCode: 'pro', status: 'active' })
        )

        expect(res.status).toBe(200)
        const ledger = await BillingEvent.findOne({ type: 'subscription.updated' }).lean()
        expect(ledger?.error).toBeTruthy()
        expect(ledger?.processedAt ?? null).toBeNull()
        expect(await Subscription.countDocuments({})).toBe(1)
        await unchanged()
    })

    it('a checkout naming a user that does not exist (or is not an id) does not 500 or create a row', async () => {
        for (const userId of ['000000000000000000000000', 'not-an-object-id']) {
            const res = await postWebhook(
                app,
                buildEvent({ type: 'checkout.completed', userId, providerCustomerId: 'cus_x', providerSubscriptionId: 'sub_x', planCode: 'pro', status: 'active' })
            )

            expect(res.status).toBe(200)
        }
        expect(await Subscription.countDocuments({})).toBe(1)
    })

    it('a plan code outside the catalogue is never granted', async () => {
        await send({ type: 'subscription.updated', planCode: 'enterprise-unlimited', status: 'active' })

        expect((await BillingEvent.findOne({ type: 'subscription.updated' }).lean())?.error).toBeTruthy()
        await unchanged()
    })

    it('a status outside the state machine is never written', async () => {
        await send({ type: 'subscription.updated', status: 'paused' as never })

        expect((await BillingEvent.findOne({ type: 'subscription.updated' }).lean())?.error).toBeTruthy()
        await unchanged()
    })
})
