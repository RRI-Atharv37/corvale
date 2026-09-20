import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { Workspace } from '@modules/workspaces'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { authHeader, registerUser, type RegisteredUser } from '@tests/helpers'
import {
    BILLING_STATES,
    createAccountViaApi,
    disableBilling,
    enableBilling,
    getFoodMasterId,
    installFakeBillingProvider,
    resetBillingProvider,
    seedTestPlans,
    setSubscription,
} from '@tests/billingHelpers'

/**
 * M1 - server-side gate enforcement, called directly against the API (ROADMAP risk #4: the client
 * gate is UX only). No test here goes near the frontend; every request is a raw HTTP call with a
 * valid token, exactly what a user with devtools or curl could send.
 *
 * Contract: a feature the plan lacks -> 402 ERROR_MESSAGES.BILLING.ENTITLEMENT_REQUIRED;
 * a lapsed subscription writing -> 402 ERROR_MESSAGES.BILLING.READ_ONLY; both before any state
 * is created. With BILLING_ENABLED unset (self-hosted / today's deployment) nothing is gated.
 */

const createWorkspace = (token: string, extra: Record<string, unknown> = {}) =>
    request(app).post('/api/v1/workspaces').set(authHeader(token)).send({ name: 'Household', ...extra })

describe('feature gate - workspaces (Pro only)', () => {
    let user: RegisteredUser

    beforeEach(async () => {
        enableBilling()
        await seedTestPlans()
        user = await registerUser(app)
    })

    afterEach(() => disableBilling())

    it('Plus is refused with 402 ENTITLEMENT_REQUIRED and nothing is created', async () => {
        await setSubscription(user.userId, { planCode: 'plus' })

        const res = await createWorkspace(user.token)

        expect(res.status).toBe(402)
        expect(res.body.success).toBe(false)
        expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.ENTITLEMENT_REQUIRED)
        expect(await Workspace.countDocuments({})).toBe(0)
    })

    it('Pro is allowed', async () => {
        await setSubscription(user.userId, { planCode: 'pro' })

        const res = await createWorkspace(user.token)

        expect(res.status).toBe(201)
    })

    it('a trialing user gets the trial plan features', async () => {
        await setSubscription(user.userId, BILLING_STATES.trialing)

        const res = await createWorkspace(user.token)

        expect(res.status).toBe(201)
    })

    it('an upgrade takes effect on the very next request - no re-login, no cached entitlement', async () => {
        await setSubscription(user.userId, { planCode: 'plus' })
        expect((await createWorkspace(user.token)).status).toBe(402)

        await setSubscription(user.userId, { planCode: 'pro' })

        expect((await createWorkspace(user.token)).status).toBe(201)
    })

    it('a downgrade takes effect on the very next request', async () => {
        await setSubscription(user.userId, { planCode: 'pro' })
        expect((await createWorkspace(user.token, { name: 'One' })).status).toBe(201)

        await setSubscription(user.userId, { planCode: 'plus' })

        expect((await createWorkspace(user.token, { name: 'Two' })).status).toBe(402)
    })

    it('refuses the gated request before validating its body', async () => {
        await setSubscription(user.userId, { planCode: 'plus' })

        const res = await request(app).post('/api/v1/workspaces').set(authHeader(user.token)).send({})

        expect(res.status).toBe(402)
    })
})

describe('the client cannot assert its own entitlement', () => {
    let user: RegisteredUser

    beforeEach(async () => {
        enableBilling()
        await seedTestPlans()
        installFakeBillingProvider()
        user = await registerUser(app)
        await setSubscription(user.userId, { planCode: 'plus' })
    })

    afterEach(() => {
        disableBilling()
        resetBillingProvider()
    })

    it('ignores plan / entitlement fields smuggled into the body', async () => {
        const res = await createWorkspace(user.token, {
            planCode: 'pro',
            plan: 'pro',
            entitlements: { features: { workspaces: true }, canWrite: true },
            subscription: { planCode: 'pro', status: 'active' },
        })

        expect(res.status).toBe(402)
    })

    it('ignores plan headers and query params', async () => {
        const res = await request(app)
            .post('/api/v1/workspaces?planCode=pro&plan=pro')
            .set(authHeader(user.token))
            .set('X-Plan', 'pro')
            .set('X-Corvale-Plan', 'pro')
            .send({ name: 'Household' })

        expect(res.status).toBe(402)
    })

    it('a webhook-shaped POST from a user with a valid token changes nothing', async () => {
        const res = await request(app)
            .post('/api/v1/billing/webhook')
            .set(authHeader(user.token))
            .send({ type: 'subscription.updated', planCode: 'pro', userId: user.userId })

        expect(res.status).toBe(400)
        expect((await createWorkspace(user.token)).status).toBe(402)
    })
})

describe('billing disabled (BILLING_ENABLED unset) - the self-hosted / pre-paywall behaviour is preserved', () => {
    beforeEach(() => disableBilling())

    it('a user with no subscription can create workspaces and write data', async () => {
        const user = await registerUser(app)

        expect((await createWorkspace(user.token)).status).toBe(201)

        const accountId = await createAccountViaApi(app, user.token)
        const categoryId = await getFoodMasterId(app, user.token)
        const tx = await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(user.token))
            .send({
                type: 'expense',
                title: 'Coffee',
                amount: 4,
                date: '2026-01-15T12:00:00.000Z',
                accountId,
                categoryId,
            })
        expect(tx.status).toBe(201)
    })

    it('a lapsed subscription row is ignored while billing is off', async () => {
        const user = await registerUser(app)
        await setSubscription(user.userId, BILLING_STATES.trial_expired)

        expect((await createWorkspace(user.token)).status).toBe(201)
    })

    it('registering does not create a Subscription', async () => {
        const user = await registerUser(app)
        const { Subscription } = await import('@modules/billing')

        expect(await Subscription.countDocuments({ userId: user.userId })).toBe(0)
    })
})

describe('GET /auth/user carries the entitlement snapshot (M2d)', () => {
    afterEach(() => disableBilling())

    it('billing on: reports status, plan, features, limits and the read/write floor', async () => {
        enableBilling()
        await seedTestPlans()
        const user = await registerUser(app)
        await setSubscription(user.userId, { planCode: 'plus' })

        const res = await request(app).get('/api/v1/auth/user').set(authHeader(user.token))

        expect(res.status).toBe(200)
        const e = res.body.data.entitlements
        expect(e.billingEnabled).toBe(true)
        expect(e.status).toBe('active')
        expect(e.planCode).toBe('plus')
        expect(e.canWrite).toBe(true)
        expect(e.canRead).toBe(true)
        expect(e.canExport).toBe(true)
        expect(e.features.workspaces).toBe(false)
        expect(e.limits.syncDevices).toBe(1)
    })

    it('reflects a lapsed subscription as read-only without hiding the plan', async () => {
        enableBilling()
        await seedTestPlans()
        const user = await registerUser(app)
        await setSubscription(user.userId, BILLING_STATES.trial_expired)

        const res = await request(app).get('/api/v1/auth/user').set(authHeader(user.token))

        expect(res.body.data.entitlements.status).toBe('trial_expired')
        expect(res.body.data.entitlements.canWrite).toBe(false)
        expect(res.body.data.entitlements.canRead).toBe(true)
    })

    it('billing off: reports unlimited entitlements with billingEnabled=false', async () => {
        const user = await registerUser(app)

        const res = await request(app).get('/api/v1/auth/user').set(authHeader(user.token))

        const e = res.body.data.entitlements
        expect(e.billingEnabled).toBe(false)
        expect(e.canWrite).toBe(true)
        expect(e.features.workspaces).toBe(true)
        expect(e.limits.receiptStorageBytes).toBeNull()
    })

    it('exposes no provider identifiers', async () => {
        enableBilling()
        await seedTestPlans()
        const user = await registerUser(app)
        await setSubscription(user.userId, { providerCustomerId: 'cus_secret', providerSubscriptionId: 'sub_secret' })

        const res = await request(app).get('/api/v1/auth/user').set(authHeader(user.token))

        expect(JSON.stringify(res.body)).not.toMatch(/cus_secret|sub_secret/)
    })
})
