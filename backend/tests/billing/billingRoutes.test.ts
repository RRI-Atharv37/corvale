import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { Subscription, createFakeBillingProvider, setBillingProvider, type FakeProviderCalls } from '@modules/billing'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { authHeader, registerUser, type RegisteredUser } from '@tests/helpers'
import {
    BILLING_STATES,
    daysFromNow,
    disableBilling,
    enableBilling,
    removeSubscription,
    resetBillingProvider,
    seedTestPlans,
    setSubscription,
} from '@tests/billingHelpers'

/**
 * M6 - the account-management routes behind the billing UI. Every one of them only asks the provider
 * to do something; entitlement still changes solely on a signed webhook, so no response here may
 * touch the stored subscription.
 */

let user: RegisteredUser
let calls: FakeProviderCalls
let invoices: ReturnType<typeof createFakeBillingProvider>['invoices']

const api = (method: 'get' | 'post', path: string, token: string | null = user.token, body: object = {}) => {
    const req = request(app)[method](`/api/v1/billing${path}`)
    if (token) req.set(authHeader(token))
    return method === 'get' ? req : req.send(body)
}

const stored = () => Subscription.findOne({ userId: user.userId }).lean()

const LIVE = { ...BILLING_STATES.active, providerCustomerId: 'cus_mine', providerSubscriptionId: 'sub_mine' }

beforeEach(async () => {
    enableBilling()
    await seedTestPlans()
    const fake = createFakeBillingProvider()
    calls = fake.calls
    invoices = fake.invoices
    setBillingProvider(fake.provider)
    user = await registerUser(app)
})

afterEach(() => {
    disableBilling()
    resetBillingProvider()
})

describe('GET /billing/plans', () => {
    it('is public and lists the launch plans with prices, features and limits', async () => {
        const res = await api('get', '/plans', null)

        expect(res.status).toBe(200)
        expect(res.body.data.billingEnabled).toBe(true)
        expect(res.body.data.trialDays).toBe(30)
        const [plus, pro] = res.body.data.plans
        expect(plus).toMatchObject({ code: 'plus', name: 'Plus', prices: { monthly: 600, annual: 6000 }, features: { workspaces: false } })
        expect(pro).toMatchObject({ code: 'pro', name: 'Pro', prices: { monthly: 1200, annual: 9600 }, features: { workspaces: true } })
        expect(pro.limits).toHaveProperty('receiptStorageBytes')
        expect(pro.limits).toHaveProperty('syncDevices')
    })

    it('exposes nothing internal', async () => {
        const res = await api('get', '/plans', null)

        expect(JSON.stringify(res.body)).not.toMatch(/_id|__v|createdAt|providerVariant|variant/)
    })

    it('lists no plans while billing is off (self-hosted): there is nothing to sell', async () => {
        disableBilling()

        const res = await api('get', '/plans', null)

        expect(res.status).toBe(200)
        expect(res.body.data).toEqual({ billingEnabled: false, trialDays: 30, plans: [] })
    })

    it('still answers when the plan rows were never seeded, from the built-in catalogue', async () => {
        const { Plan } = await import('@modules/billing')
        await Plan.deleteMany({})

        const res = await api('get', '/plans', null)

        expect(res.body.data.plans.map((p: { code: string }) => p.code)).toEqual(['plus', 'pro'])
    })
})

describe('GET /billing/overview', () => {
    it('requires authentication', async () => {
        expect((await api('get', '/overview', null)).status).toBe(401)
    })

    it('says what the account can do about billing, without exposing provider ids', async () => {
        await setSubscription(user.userId, LIVE)

        const res = await api('get', '/overview')

        expect(res.status).toBe(200)
        expect(res.body.data).toMatchObject({
            billingEnabled: true,
            hasBillingCustomer: true,
            hasLiveSubscription: true,
            retentionDays: null,
        })
        expect(JSON.stringify(res.body)).not.toMatch(/cus_mine|sub_mine/)
    })

    it('a trial with no provider link has no billing customer and no live subscription', async () => {
        const res = await api('get', '/overview')

        expect(res.body.data).toMatchObject({ hasBillingCustomer: false, hasLiveSubscription: false })
    })

    it('a lapsed subscription is not live even though it keeps its provider link', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.cancelled, providerCustomerId: 'cus_mine', providerSubscriptionId: 'sub_mine' })

        const res = await api('get', '/overview')

        expect(res.body.data).toMatchObject({ hasBillingCustomer: true, hasLiveSubscription: false })
    })

    it('states the retention window only while the server is actually enforcing it', async () => {
        process.env.BILLING_RETENTION_ENABLED = 'true'
        process.env.BILLING_RETENTION_DAYS = '120'
        try {
            expect((await api('get', '/overview')).body.data.retentionDays).toBe(120)
        } finally {
            delete process.env.BILLING_RETENTION_ENABLED
            delete process.env.BILLING_RETENTION_DAYS
        }
        expect((await api('get', '/overview')).body.data.retentionDays).toBeNull()
    })

    it('answers billingEnabled false while billing is off', async () => {
        disableBilling()

        const res = await api('get', '/overview')

        expect(res.status).toBe(200)
        expect(res.body.data).toMatchObject({ billingEnabled: false, hasLiveSubscription: false })
    })
})

describe('POST /billing/checkout - one live subscription per user', () => {
    it('refuses with 409 when a live subscription exists, so a second one is never billed', async () => {
        await setSubscription(user.userId, LIVE)

        const res = await api('post', '/checkout', user.token, { planCode: 'pro', interval: 'annual' })

        expect(res.status).toBe(409)
        expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.ALREADY_SUBSCRIBED)
        expect(calls.createCheckoutSession).toHaveLength(0)
    })

    it('also refuses while a failed payment is still inside its grace window', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.past_due_in_grace, providerSubscriptionId: 'sub_mine' })

        expect((await api('post', '/checkout', user.token, { planCode: 'pro', interval: 'annual' })).status).toBe(409)
    })

    it.each(['cancelled', 'trial_expired', 'past_due_grace_elapsed'])('allows a fresh checkout from the lapsed %s state', async (state) => {
        await setSubscription(user.userId, { ...BILLING_STATES[state], providerSubscriptionId: 'sub_old' })

        expect((await api('post', '/checkout', user.token, { planCode: 'pro', interval: 'monthly' })).status).toBe(200)
    })

    it('answers 404 while billing is off', async () => {
        disableBilling()

        const res = await api('post', '/checkout', user.token, { planCode: 'plus', interval: 'monthly' })

        expect(res.status).toBe(404)
        expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.NOT_ENABLED)
    })
})

describe('POST /billing/change-plan', () => {
    it('asks the provider to move the caller\'s own subscription and reports it as requested', async () => {
        await setSubscription(user.userId, LIVE)

        const res = await api('post', '/change-plan', user.token, { planCode: 'plus', interval: 'annual' })

        expect(res.status).toBe(202)
        expect(res.body.data).toEqual({ requested: true })
        expect(calls.changePlan).toEqual([{ providerSubscriptionId: 'sub_mine', planCode: 'plus', interval: 'annual' }])
    })

    it('never changes the stored plan: entitlement moves only when the webhook arrives', async () => {
        await setSubscription(user.userId, LIVE)
        const before = await stored()

        await api('post', '/change-plan', user.token, { planCode: 'plus', interval: 'annual' })

        expect(await stored()).toEqual(before)
    })

    it('ignores a client-supplied subscription id', async () => {
        await setSubscription(user.userId, LIVE)

        await api('post', '/change-plan', user.token, {
            planCode: 'plus',
            interval: 'monthly',
            providerSubscriptionId: 'sub_someone_else',
        })

        expect(calls.changePlan[0].providerSubscriptionId).toBe('sub_mine')
    })

    it.each([
        [{ planCode: 'gold', interval: 'monthly' }],
        [{ planCode: 'plus', interval: 'weekly' }],
        [{ planCode: 'plus' }],
        [{ planCode: { $ne: 'x' }, interval: 'monthly' }],
        [{}],
    ])('rejects %j with 400 before touching the provider', async (body) => {
        await setSubscription(user.userId, LIVE)

        const res = await api('post', '/change-plan', user.token, body)

        expect(res.status).toBe(400)
        expect(calls.changePlan).toHaveLength(0)
    })

    it.each([
        ['a trial that was never paid for', BILLING_STATES.trialing],
        ['a cancelled subscription', BILLING_STATES.cancelled],
        ['an expired trial', BILLING_STATES.trial_expired],
    ])('is refused with 409 for %s', async (_label, state) => {
        await setSubscription(user.userId, { ...state, providerSubscriptionId: state === BILLING_STATES.trialing ? null : 'sub_old' })

        const res = await api('post', '/change-plan', user.token, { planCode: 'plus', interval: 'monthly' })

        expect(res.status).toBe(409)
        expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.NO_ACTIVE_SUBSCRIPTION)
        expect(calls.changePlan).toHaveLength(0)
    })

    it('requires authentication', async () => {
        expect((await api('post', '/change-plan', null, { planCode: 'plus', interval: 'monthly' })).status).toBe(401)
    })

    it('answers 404 while billing is off', async () => {
        disableBilling()

        expect((await api('post', '/change-plan', user.token, { planCode: 'plus', interval: 'monthly' })).status).toBe(404)
    })
})

describe('POST /billing/cancel', () => {
    it('asks the provider to cancel the caller\'s own subscription and changes nothing locally', async () => {
        await setSubscription(user.userId, LIVE)
        const before = await stored()

        const res = await api('post', '/cancel')

        expect(res.status).toBe(202)
        expect(calls.cancelSubscription).toEqual([{ providerSubscriptionId: 'sub_mine' }])
        expect(await stored()).toEqual(before)
    })

    it('is refused with 409 when the subscription is already set to end', async () => {
        await setSubscription(user.userId, { ...LIVE, cancelAtPeriodEnd: true })

        const res = await api('post', '/cancel')

        expect(res.status).toBe(409)
        expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.ALREADY_CANCELLING)
        expect(calls.cancelSubscription).toHaveLength(0)
    })

    it('is refused with 409 when there is nothing live to cancel', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.cancelled, providerSubscriptionId: 'sub_old' })

        const res = await api('post', '/cancel')

        expect(res.status).toBe(409)
        expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.NO_ACTIVE_SUBSCRIPTION)
    })

    it('is refused for a user with no subscription row at all', async () => {
        await removeSubscription(user.userId)

        expect((await api('post', '/cancel')).status).toBe(409)
    })

    it('can cancel while a failed payment is inside its grace window', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.past_due_in_grace, providerSubscriptionId: 'sub_mine' })

        expect((await api('post', '/cancel')).status).toBe(202)
    })

    it('requires authentication', async () => {
        expect((await api('post', '/cancel', null)).status).toBe(401)
    })
})

describe('POST /billing/resume', () => {
    it('asks the provider to un-cancel a subscription that is set to end', async () => {
        await setSubscription(user.userId, { ...LIVE, cancelAtPeriodEnd: true, currentPeriodEnd: daysFromNow(10) })
        const before = await stored()

        const res = await api('post', '/resume')

        expect(res.status).toBe(202)
        expect(calls.resumeSubscription).toEqual([{ providerSubscriptionId: 'sub_mine' }])
        expect(await stored()).toEqual(before)
    })

    it('is refused with 409 when the subscription is not set to end', async () => {
        await setSubscription(user.userId, LIVE)

        const res = await api('post', '/resume')

        expect(res.status).toBe(409)
        expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.NOT_CANCELLING)
        expect(calls.resumeSubscription).toHaveLength(0)
    })

    it('is refused once the period has already ended - that is a new checkout, not a resume', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.cancelling_period_elapsed, providerSubscriptionId: 'sub_old' })

        expect((await api('post', '/resume')).status).toBe(409)
    })

    it('requires authentication', async () => {
        expect((await api('post', '/resume', null)).status).toBe(401)
    })
})

describe('GET /billing/invoices', () => {
    const paid = (id: string, day: number) => ({
        id,
        issuedAt: new Date(Date.UTC(2026, 0, day)),
        total: 1200,
        currency: 'USD',
        status: 'paid' as const,
        url: `https://fake.test/invoice/${id}`,
    })

    it('lists the invoices of the caller\'s own subscription, newest first', async () => {
        await setSubscription(user.userId, LIVE)
        invoices.push(paid('a', 1), paid('b', 20))

        const res = await api('get', '/invoices')

        expect(res.status).toBe(200)
        expect(res.body.data.invoices.map((i: { id: string }) => i.id)).toEqual(['b', 'a'])
        expect(res.body.data.invoices[0]).toEqual({
            id: 'b',
            issuedAt: '2026-01-20T00:00:00.000Z',
            total: 1200,
            currency: 'USD',
            status: 'paid',
            url: 'https://fake.test/invoice/b',
        })
        expect(calls.listInvoices).toEqual([{ providerSubscriptionId: 'sub_mine' }])
    })

    it('still lists them after the subscription lapsed: a receipt is never locked away', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.cancelled, providerSubscriptionId: 'sub_old' })
        invoices.push(paid('a', 1))

        const res = await api('get', '/invoices')

        expect(res.status).toBe(200)
        expect(res.body.data.invoices).toHaveLength(1)
    })

    it('answers an empty list for a user who has never paid, without calling the provider', async () => {
        const res = await api('get', '/invoices')

        expect(res.status).toBe(200)
        expect(res.body.data.invoices).toEqual([])
        expect(calls.listInvoices).toHaveLength(0)
    })

    it('answers 404 while billing is off', async () => {
        disableBilling()

        expect((await api('get', '/invoices')).status).toBe(404)
    })

    it('requires authentication', async () => {
        expect((await api('get', '/invoices', null)).status).toBe(401)
    })
})

describe('users are isolated from each other', () => {
    it('a request only ever reaches the token holder\'s own provider subscription', async () => {
        const other = await registerUser(app, { email: 'other-billing@example.com', fullName: 'Other Billing' })
        await setSubscription(other.userId, { ...LIVE, providerCustomerId: 'cus_other', providerSubscriptionId: 'sub_other' })
        await setSubscription(user.userId, LIVE)

        await api('post', '/cancel', user.token)
        await api('get', '/invoices', user.token)

        expect(calls.cancelSubscription).toEqual([{ providerSubscriptionId: 'sub_mine' }])
        expect(calls.listInvoices).toEqual([{ providerSubscriptionId: 'sub_mine' }])
    })
})
