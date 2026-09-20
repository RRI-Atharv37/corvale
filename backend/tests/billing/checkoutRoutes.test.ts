import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { Subscription } from '@modules/billing'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { authHeader, registerUser, type RegisteredUser } from '@tests/helpers'
import {
    BILLING_STATES,
    disableBilling,
    enableBilling,
    installFakeBillingProvider,
    removeSubscription,
    resetBillingProvider,
    seedTestPlans,
    setSubscription,
    type FakeProviderCalls,
} from '@tests/billingHelpers'

/**
 * M1 - the two user-facing billing routes (M3): `POST /billing/checkout` and `POST /billing/portal`.
 * They only ever hand back a provider URL. Entitlement changes solely on a signed webhook (M3b #4),
 * so nothing here - however the client dresses up its request - can change what a user is entitled
 * to. Both stay usable in EVERY subscription state: a lapsed user must always be able to pay.
 */

let user: RegisteredUser
let calls: FakeProviderCalls

const checkout = (token: string, body: Record<string, unknown>) =>
    request(app).post('/api/v1/billing/checkout').set(authHeader(token)).send(body)

const subscription = () => Subscription.findOne({ userId: user.userId }).lean()

beforeEach(async () => {
    enableBilling()
    await seedTestPlans()
    calls = installFakeBillingProvider()
    user = await registerUser(app)
})

afterEach(() => {
    disableBilling()
    resetBillingProvider()
})

describe('POST /billing/checkout', () => {
    it('returns the provider checkout URL for a valid plan and interval', async () => {
        const res = await checkout(user.token, { planCode: 'plus', interval: 'monthly' })

        expect(res.status).toBe(200)
        expect(res.body.data.url).toBe('https://fake.test/checkout/plus/monthly')
        expect(calls.createCheckoutSession).toHaveLength(1)
        expect(calls.createCheckoutSession[0]).toMatchObject({ planCode: 'plus', interval: 'monthly', userId: user.userId, email: user.email })
    })

    it('never changes entitlement: the subscription is byte-for-byte the same afterwards', async () => {
        await setSubscription(user.userId, BILLING_STATES.trialing)
        const before = await subscription()

        await checkout(user.token, { planCode: 'pro', interval: 'annual', success: true, status: 'active', paid: true })

        expect(await subscription()).toEqual(before)
    })

    it('binds the session to the token holder: a client-supplied userId or customer id is ignored', async () => {
        await checkout(user.token, {
            planCode: 'plus',
            interval: 'monthly',
            userId: '000000000000000000000000',
            providerCustomerId: 'cus_someone_else',
        })

        expect(calls.createCheckoutSession[0].userId).toBe(user.userId)
        expect(calls.createCheckoutSession[0].providerCustomerId).not.toBe('cus_someone_else')
    })

    it.each([
        [{ planCode: 'gold', interval: 'monthly' }],
        [{ planCode: 'plus', interval: 'weekly' }],
        [{ planCode: 'plus' }],
        [{ interval: 'monthly' }],
        [{ planCode: { $ne: 'x' }, interval: 'monthly' }],
        [{}],
    ])('rejects %j with 400 and never calls the provider', async (body) => {
        const res = await checkout(user.token, body)

        expect(res.status).toBe(400)
        expect(calls.createCheckoutSession).toHaveLength(0)
    })

    it('requires authentication', async () => {
        const res = await request(app).post('/api/v1/billing/checkout').send({ planCode: 'plus', interval: 'monthly' })

        expect(res.status).toBe(401)
    })

    it.each(['trial_expired', 'cancelled', 'past_due_grace_elapsed'])('is available to a user in the read-only %s state', async (state) => {
        await setSubscription(user.userId, BILLING_STATES[state])

        const res = await checkout(user.token, { planCode: 'plus', interval: 'annual' })

        expect(res.status).toBe(200)
    })

    it('is available to a user with no subscription row', async () => {
        await removeSubscription(user.userId)

        expect((await checkout(user.token, { planCode: 'pro', interval: 'monthly' })).status).toBe(200)
    })
})

describe('POST /billing/portal', () => {
    it('returns the hosted portal URL for the caller\'s own provider customer', async () => {
        await setSubscription(user.userId, { providerCustomerId: 'cus_mine' })

        const res = await request(app).post('/api/v1/billing/portal').set(authHeader(user.token)).send({})

        expect(res.status).toBe(200)
        expect(res.body.data.url).toBe('https://fake.test/portal/cus_mine')
    })

    it('ignores a client-supplied customer id: you can only open your own portal', async () => {
        await setSubscription(user.userId, { providerCustomerId: 'cus_mine' })

        await request(app)
            .post('/api/v1/billing/portal')
            .set(authHeader(user.token))
            .send({ providerCustomerId: 'cus_victim' })

        expect(calls.getPortalUrl).toHaveLength(1)
        expect(calls.getPortalUrl[0].providerCustomerId).toBe('cus_mine')
    })

    it('a user who has never paid (no provider customer) gets 404 NO_BILLING_CUSTOMER, not a foreign portal', async () => {
        await setSubscription(user.userId, { providerCustomerId: null, providerSubscriptionId: null })

        const res = await request(app).post('/api/v1/billing/portal').set(authHeader(user.token)).send({})

        expect(res.status).toBe(404)
        expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.NO_BILLING_CUSTOMER)
        expect(calls.getPortalUrl).toHaveLength(0)
    })

    it('is available while read-only, so a lapsed user can update a card', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.cancelled, providerCustomerId: 'cus_mine' })

        expect((await request(app).post('/api/v1/billing/portal').set(authHeader(user.token)).send({})).status).toBe(200)
    })

    it('requires authentication', async () => {
        expect((await request(app).post('/api/v1/billing/portal').send({})).status).toBe(401)
    })
})
