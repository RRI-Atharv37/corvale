import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { authHeader, seedUserDirectly } from './helpers'

/**
 * Sprint 11.0 acceptance criteria for the subscription tracker (11.3).
 *
 * Contract defined by these tests (implementation must satisfy):
 *   GET /api/v1/subscriptions?workspaceId=
 *   -> { success, data: { subscriptions: [{ ruleId, title, amount, currency, interval,
 *        monthlyCost, annualCost, nextChargeDate, categoryId, accountId, isCancelled }],
 *        totalMonthlyCost, totalAnnualCost } }
 *
 * Eligibility: recurring rules with type='expense', isActive=true, isArchived=false, and
 * interval in [daily, weekly, biweekly, monthly] (quarterly/yearly/custom do not qualify as
 * "subscriptions"). Cancelled subscriptions (isCancelled=true, set via the existing
 * PUT /api/v1/recurring-rules/:id endpoint) remain listed but are excluded from totals.
 *
 * Cost normalization (minor units, annual-first to avoid rounding drift):
 *   annualCost: daily => amount*365, weekly => amount*52, biweekly => amount*26, monthly => amount*12
 *   monthlyCost = round(annualCost / 12)
 */

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    return res.body.data.masters.find((m: { name: string }) => m.name === 'Food')._id
}

async function getIncomeMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    return res.body.data.masters.find((m: { name: string }) => m.name === 'Income')._id
}

async function createTestAccount(token: string, name = 'Checking', openingBalance = 1000) {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'checking', openingBalance })
    return res.body.data
}

async function createRecurringRule(token: string, overrides: Record<string, unknown> = {}) {
    const account = overrides.accountId ? { _id: overrides.accountId } : await createTestAccount(token)
    const categoryId =
        typeof overrides.categoryId === 'string' ? overrides.categoryId : await getFoodMasterId(token)

    return request(app)
        .post('/api/v1/recurring-rules')
        .set(authHeader(token))
        .send({
            title: 'Netflix',
            type: 'expense',
            amount: 15.99,
            accountId: account._id,
            categoryId,
            interval: 'monthly',
            nextDueDate: '2026-03-01',
            ...overrides,
        })
}

async function getSubscriptions(token: string, query = '') {
    return request(app).get(`/api/v1/subscriptions${query}`).set(authHeader(token))
}

describe('Subscriptions API - validation and auth', () => {
    it('rejects unauthenticated requests', async () => {
        const res = await request(app).get('/api/v1/subscriptions')
        expect(res.status).toBe(401)
    })

    it('returns an empty list with zero totals when there are no eligible rules', async () => {
        const { token } = await seedUserDirectly({ email: 'sub-empty@example.com' })

        const res = await getSubscriptions(token)
        expect(res.status).toBe(200)
        expect(res.body.data.subscriptions).toEqual([])
        expect(res.body.data.totalMonthlyCost).toBe(0)
        expect(res.body.data.totalAnnualCost).toBe(0)
    })
})

describe('Subscriptions API - derivation eligibility', () => {
    it('includes daily, weekly, biweekly, and monthly expense rules', async () => {
        const { token } = await seedUserDirectly({ email: 'sub-eligible@example.com' })

        await createRecurringRule(token, { title: 'Daily coffee', interval: 'daily', nextDueDate: '2026-03-01' })
        await createRecurringRule(token, { title: 'Weekly meal kit', interval: 'weekly', nextDueDate: '2026-03-01' })
        await createRecurringRule(token, { title: 'Biweekly cleaner', interval: 'biweekly', nextDueDate: '2026-03-01' })
        await createRecurringRule(token, { title: 'Netflix', interval: 'monthly', nextDueDate: '2026-03-01' })

        const res = await getSubscriptions(token)
        const titles = res.body.data.subscriptions.map((s: { title: string }) => s.title)

        expect(titles).toContain('Daily coffee')
        expect(titles).toContain('Weekly meal kit')
        expect(titles).toContain('Biweekly cleaner')
        expect(titles).toContain('Netflix')
        expect(res.body.data.subscriptions).toHaveLength(4)
    })

    it('excludes quarterly, yearly, and custom interval rules', async () => {
        const { token } = await seedUserDirectly({ email: 'sub-excluded-interval@example.com' })

        await createRecurringRule(token, { title: 'Quarterly tax service', interval: 'quarterly', nextDueDate: '2026-03-01' })
        await createRecurringRule(token, { title: 'Annual domain', interval: 'yearly', nextDueDate: '2026-03-01' })
        await createRecurringRule(token, { title: 'Custom bill', interval: 'custom', customIntervalDays: 45, nextDueDate: '2026-03-01' })

        const res = await getSubscriptions(token)
        expect(res.body.data.subscriptions).toHaveLength(0)
    })

    it('excludes income-type recurring rules', async () => {
        const { token } = await seedUserDirectly({ email: 'sub-excluded-income@example.com' })
        const categoryId = await getIncomeMasterId(token)

        await createRecurringRule(token, {
            title: 'Salary',
            type: 'income',
            categoryId,
            interval: 'monthly',
            nextDueDate: '2026-03-01',
        })

        const res = await getSubscriptions(token)
        expect(res.body.data.subscriptions).toHaveLength(0)
    })

    it('excludes inactive and archived rules', async () => {
        const { token } = await seedUserDirectly({ email: 'sub-excluded-status@example.com' })

        const inactiveRes = await createRecurringRule(token, { title: 'Paused sub' })
        await request(app)
            .put(`/api/v1/recurring-rules/${inactiveRes.body.data._id}`)
            .set(authHeader(token))
            .send({ isActive: false })

        const archivedRes = await createRecurringRule(token, { title: 'Cancelled rule' })
        await request(app)
            .delete(`/api/v1/recurring-rules/${archivedRes.body.data._id}`)
            .set(authHeader(token))

        const res = await getSubscriptions(token)
        expect(res.body.data.subscriptions).toHaveLength(0)
    })

    it('does not leak another user subscriptions', async () => {
        const owner = await seedUserDirectly({ email: 'sub-owner@example.com' })
        const other = await seedUserDirectly({ email: 'sub-other@example.com' })

        await createRecurringRule(owner.token, { title: 'Owner sub' })

        const res = await getSubscriptions(other.token)
        expect(res.body.data.subscriptions).toHaveLength(0)
    })
})

describe('Subscriptions API - cost calculations', () => {
    it('computes monthly and annual cost for a monthly subscription', async () => {
        const { token } = await seedUserDirectly({ email: 'sub-cost-monthly@example.com' })

        await createRecurringRule(token, { title: 'Netflix', amount: 15.99, interval: 'monthly' })

        const res = await getSubscriptions(token)
        const sub = res.body.data.subscriptions.find((s: { title: string }) => s.title === 'Netflix')

        expect(sub.monthlyCost).toBe(15.99)
        expect(sub.annualCost).toBe(191.88)
    })

    it('computes monthly and annual cost for a weekly subscription', async () => {
        const { token } = await seedUserDirectly({ email: 'sub-cost-weekly@example.com' })

        await createRecurringRule(token, { title: 'Meal kit', amount: 10, interval: 'weekly' })

        const res = await getSubscriptions(token)
        const sub = res.body.data.subscriptions.find((s: { title: string }) => s.title === 'Meal kit')

        expect(sub.annualCost).toBe(520)
        expect(sub.monthlyCost).toBeCloseTo(43.33, 2)
    })

    it('computes monthly and annual cost for a daily subscription', async () => {
        const { token } = await seedUserDirectly({ email: 'sub-cost-daily@example.com' })

        await createRecurringRule(token, { title: 'Coffee', amount: 1, interval: 'daily' })

        const res = await getSubscriptions(token)
        const sub = res.body.data.subscriptions.find((s: { title: string }) => s.title === 'Coffee')

        expect(sub.annualCost).toBe(365)
        expect(sub.monthlyCost).toBeCloseTo(30.42, 2)
    })

    it('sums totalMonthlyCost and totalAnnualCost across all active subscriptions', async () => {
        const { token } = await seedUserDirectly({ email: 'sub-cost-total@example.com' })

        await createRecurringRule(token, { title: 'Netflix', amount: 15.99, interval: 'monthly' })
        await createRecurringRule(token, { title: 'Spotify', amount: 9.99, interval: 'monthly' })

        const res = await getSubscriptions(token)
        expect(res.body.data.totalMonthlyCost).toBeCloseTo(25.98, 2)
        expect(res.body.data.totalAnnualCost).toBeCloseTo(311.76, 2)
    })
})

describe('Subscriptions API - cancelled flag', () => {
    it('marks a subscription cancelled via the recurring rule update endpoint', async () => {
        const { token } = await seedUserDirectly({ email: 'sub-cancel@example.com' })

        const createRes = await createRecurringRule(token, { title: 'Gym', amount: 40, interval: 'monthly' })
        const ruleId = createRes.body.data._id

        const before = await getSubscriptions(token)
        expect(before.body.data.subscriptions.find((s: { ruleId: string }) => s.ruleId === ruleId).isCancelled).toBe(false)

        const updateRes = await request(app)
            .put(`/api/v1/recurring-rules/${ruleId}`)
            .set(authHeader(token))
            .send({ isCancelled: true })
        expect(updateRes.status).toBe(200)

        const after = await getSubscriptions(token)
        const sub = after.body.data.subscriptions.find((s: { ruleId: string }) => s.ruleId === ruleId)
        expect(sub.isCancelled).toBe(true)
    })

    it('excludes cancelled subscriptions from totals but keeps them listed', async () => {
        const { token } = await seedUserDirectly({ email: 'sub-cancel-totals@example.com' })

        const activeRes = await createRecurringRule(token, { title: 'Active sub', amount: 10, interval: 'monthly' })
        const cancelledRes = await createRecurringRule(token, { title: 'Cancelled sub', amount: 20, interval: 'monthly' })

        await request(app)
            .put(`/api/v1/recurring-rules/${cancelledRes.body.data._id}`)
            .set(authHeader(token))
            .send({ isCancelled: true })

        const res = await getSubscriptions(token)
        expect(res.body.data.subscriptions).toHaveLength(2)
        expect(res.body.data.totalMonthlyCost).toBe(10)

        void activeRes
    })
})

describe('Subscriptions API - workspace scoping', () => {
    it('only includes workspace-scoped subscriptions for workspace members', async () => {
        const owner = await seedUserDirectly({ email: 'sub-ws-owner@example.com' })

        const wsRes = await request(app)
            .post('/api/v1/workspaces')
            .set(authHeader(owner.token))
            .send({ name: 'Household' })
        const workspaceId = wsRes.body.data._id

        const wsAccountRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(owner.token))
            .send({ name: 'Shared', type: 'checking', openingBalance: 200, workspaceId })
        const categoryId = await getFoodMasterId(owner.token)

        await request(app)
            .post('/api/v1/recurring-rules')
            .set(authHeader(owner.token))
            .send({
                title: 'Shared subscription',
                type: 'expense',
                amount: 12,
                accountId: wsAccountRes.body.data._id,
                categoryId,
                interval: 'monthly',
                nextDueDate: '2026-03-01',
                workspaceId,
            })

        await createRecurringRule(owner.token, { title: 'Personal subscription' })

        const res = await getSubscriptions(owner.token, `?workspaceId=${workspaceId}`)
        const titles = res.body.data.subscriptions.map((s: { title: string }) => s.title)
        expect(titles).toContain('Shared subscription')
        expect(titles).not.toContain('Personal subscription')
    })
})

describe('subscriptionUtils', () => {
    it('determines subscription eligibility by type, status, and interval', async () => {
        const { isSubscriptionEligible } = await import('@modules/subscriptions/subscriptionUtils')

        expect(isSubscriptionEligible({ type: 'expense', isActive: true, isArchived: false, interval: 'monthly' } as never)).toBe(true)
        expect(isSubscriptionEligible({ type: 'expense', isActive: true, isArchived: false, interval: 'yearly' } as never)).toBe(false)
        expect(isSubscriptionEligible({ type: 'income', isActive: true, isArchived: false, interval: 'monthly' } as never)).toBe(false)
        expect(isSubscriptionEligible({ type: 'expense', isActive: false, isArchived: false, interval: 'monthly' } as never)).toBe(false)
        expect(isSubscriptionEligible({ type: 'expense', isActive: true, isArchived: true, interval: 'monthly' } as never)).toBe(false)
    })

    it('computes annual and monthly cost in minor units', async () => {
        const { computeAnnualCostMinor, computeMonthlyCostMinor } = await import('@modules/subscriptions/subscriptionUtils')

        expect(computeAnnualCostMinor(1599, 'monthly')).toBe(19188)
        expect(computeMonthlyCostMinor(1599, 'monthly')).toBe(1599)
        expect(computeAnnualCostMinor(1000, 'weekly')).toBe(52000)
        expect(computeMonthlyCostMinor(1000, 'weekly')).toBe(4333)
    })
})
