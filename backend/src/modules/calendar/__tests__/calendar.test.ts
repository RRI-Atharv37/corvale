import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { authHeader, seedUserDirectly } from '@tests/helpers'

/**
 * Sprint 11.0 acceptance criteria for the unified financial calendar (11.2).
 *
 * Contract defined by these tests (implementation must satisfy):
 *   GET /api/v1/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD&workspaceId=
 *   -> { success, data: [{ id, type: 'recurring'|'budget_end'|'goal_deadline', date, title,
 *        amount?, refId, accountId?, categoryId? }] }
 *   sorted ascending by date.
 */

function daysFromNowStr(offset: number): string {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + offset)
    return d.toISOString().slice(0, 10)
}

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    return res.body.data.masters.find((m: { name: string }) => m.name === 'Food')._id
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
            title: 'Rent',
            type: 'expense',
            amount: 100,
            accountId: account._id,
            categoryId,
            interval: 'monthly',
            nextDueDate: daysFromNowStr(5),
            ...overrides,
        })
}

async function getCalendar(token: string, query: string) {
    return request(app).get(`/api/v1/calendar${query}`).set(authHeader(token))
}

describe('Calendar API - validation and auth', () => {
    it('rejects unauthenticated requests', async () => {
        const res = await request(app).get(
            `/api/v1/calendar?start=${daysFromNowStr(0)}&end=${daysFromNowStr(30)}`
        )
        expect(res.status).toBe(401)
    })

    it('requires start and end query params', async () => {
        const { token } = await seedUserDirectly({ email: 'calendar-missing-range@example.com' })

        const res = await getCalendar(token, '')
        expect(res.status).toBe(400)
    })

    it('rejects an invalid date range where start is after end', async () => {
        const { token } = await seedUserDirectly({ email: 'calendar-bad-range@example.com' })

        const res = await getCalendar(token, `?start=${daysFromNowStr(30)}&end=${daysFromNowStr(0)}`)
        expect(res.status).toBe(400)
    })

    it('rejects malformed date strings', async () => {
        const { token } = await seedUserDirectly({ email: 'calendar-malformed@example.com' })

        const res = await getCalendar(token, '?start=not-a-date&end=2026-02-01')
        expect(res.status).toBe(400)
    })

    it('returns 200 with an empty array when nothing falls in range', async () => {
        const { token } = await seedUserDirectly({ email: 'calendar-empty@example.com' })

        const res = await getCalendar(token, `?start=${daysFromNowStr(0)}&end=${daysFromNowStr(30)}`)
        expect(res.status).toBe(200)
        expect(res.body.data).toEqual([])
    })
})

describe('Calendar API - recurring due dates', () => {
    it('includes a recurring occurrence within range with refId and amount', async () => {
        const { token } = await seedUserDirectly({ email: 'calendar-recurring@example.com' })
        const account = await createTestAccount(token)

        const ruleRes = await createRecurringRule(token, {
            title: 'Netflix',
            amount: 15.99,
            accountId: account._id,
            interval: 'monthly',
            nextDueDate: daysFromNowStr(10),
        })

        const res = await getCalendar(token, `?start=${daysFromNowStr(0)}&end=${daysFromNowStr(30)}`)
        const recurringEvents = res.body.data.filter((e: { type: string }) => e.type === 'recurring')

        expect(recurringEvents).toHaveLength(1)
        expect(recurringEvents[0]).toMatchObject({
            type: 'recurring',
            title: 'Netflix',
            amount: 15.99,
            date: daysFromNowStr(10),
            refId: ruleRes.body.data._id,
        })
    })

    it('includes multiple occurrences for a weekly rule spanning the range', async () => {
        const { token } = await seedUserDirectly({ email: 'calendar-recurring-multi@example.com' })
        const account = await createTestAccount(token)

        await createRecurringRule(token, {
            title: 'Groceries budget',
            accountId: account._id,
            interval: 'weekly',
            nextDueDate: daysFromNowStr(1),
        })

        const res = await getCalendar(token, `?start=${daysFromNowStr(0)}&end=${daysFromNowStr(30)}`)
        const recurringEvents = res.body.data.filter((e: { type: string }) => e.type === 'recurring')

        expect(recurringEvents.length).toBeGreaterThanOrEqual(4)
    })

    it('excludes inactive and archived recurring rules', async () => {
        const { token } = await seedUserDirectly({ email: 'calendar-recurring-inactive@example.com' })
        const account = await createTestAccount(token)

        const ruleRes = await createRecurringRule(token, { accountId: account._id, nextDueDate: daysFromNowStr(5) })
        await request(app)
            .delete(`/api/v1/recurring-rules/${ruleRes.body.data._id}`)
            .set(authHeader(token))

        const res = await getCalendar(token, `?start=${daysFromNowStr(0)}&end=${daysFromNowStr(30)}`)
        expect(res.body.data.filter((e: { type: string }) => e.type === 'recurring')).toHaveLength(0)
    })
})

describe('Calendar API - budget period boundaries', () => {
    it('includes a budget period end within range', async () => {
        const { token } = await seedUserDirectly({ email: 'calendar-budget@example.com' })

        const budgetRes = await request(app)
            .post('/api/v1/budgets')
            .set(authHeader(token))
            .send({ periodType: 'monthly', year: 2026, month: 1, amount: 500 })

        const res = await getCalendar(token, '?start=2026-01-01&end=2026-01-31')
        const budgetEvents = res.body.data.filter((e: { type: string }) => e.type === 'budget_end')

        expect(budgetEvents).toHaveLength(1)
        expect(budgetEvents[0].refId).toBe(budgetRes.body.data._id)
        expect(budgetEvents[0].date).toBe('2026-01-31')
    })

    it('excludes archived budgets', async () => {
        const { token } = await seedUserDirectly({ email: 'calendar-budget-archived@example.com' })

        const budgetRes = await request(app)
            .post('/api/v1/budgets')
            .set(authHeader(token))
            .send({ periodType: 'monthly', year: 2026, month: 1, amount: 500 })
        await request(app)
            .delete(`/api/v1/budgets/${budgetRes.body.data._id}`)
            .set(authHeader(token))

        const res = await getCalendar(token, '?start=2026-01-01&end=2026-01-31')
        expect(res.body.data.filter((e: { type: string }) => e.type === 'budget_end')).toHaveLength(0)
    })

    it('excludes a budget period end outside the requested range', async () => {
        const { token } = await seedUserDirectly({ email: 'calendar-budget-outside@example.com' })

        await request(app)
            .post('/api/v1/budgets')
            .set(authHeader(token))
            .send({ periodType: 'monthly', year: 2026, month: 3, amount: 500 })

        const res = await getCalendar(token, '?start=2026-01-01&end=2026-01-31')
        expect(res.body.data.filter((e: { type: string }) => e.type === 'budget_end')).toHaveLength(0)
    })
})

describe('Calendar API - goal deadlines', () => {
    it('includes a savings goal targetDate within range', async () => {
        const { token } = await seedUserDirectly({ email: 'calendar-goal@example.com' })

        const goalRes = await request(app)
            .post('/api/v1/savings-goals')
            .set(authHeader(token))
            .send({ name: 'Vacation', targetAmount: 2000, targetDate: '2026-01-20' })

        const res = await getCalendar(token, '?start=2026-01-01&end=2026-01-31')
        const goalEvents = res.body.data.filter((e: { type: string }) => e.type === 'goal_deadline')

        expect(goalEvents).toHaveLength(1)
        expect(goalEvents[0].refId).toBe(goalRes.body.data._id)
        expect(goalEvents[0].title).toBe('Vacation')
        expect(goalEvents[0].date).toBe('2026-01-20')
    })

    it('excludes goals without a targetDate', async () => {
        const { token } = await seedUserDirectly({ email: 'calendar-goal-no-date@example.com' })

        await request(app)
            .post('/api/v1/savings-goals')
            .set(authHeader(token))
            .send({ name: 'No deadline', targetAmount: 2000 })

        const res = await getCalendar(token, `?start=${daysFromNowStr(0)}&end=${daysFromNowStr(365)}`)
        expect(res.body.data.filter((e: { type: string }) => e.type === 'goal_deadline')).toHaveLength(0)
    })

    it('excludes completed and archived goals', async () => {
        const { token } = await seedUserDirectly({ email: 'calendar-goal-completed@example.com' })

        const goalRes = await request(app)
            .post('/api/v1/savings-goals')
            .set(authHeader(token))
            .send({ name: 'Done goal', targetAmount: 100, targetDate: '2026-01-20' })
        await request(app)
            .delete(`/api/v1/savings-goals/${goalRes.body.data._id}`)
            .set(authHeader(token))

        const res = await getCalendar(token, '?start=2026-01-01&end=2026-01-31')
        expect(res.body.data.filter((e: { type: string }) => e.type === 'goal_deadline')).toHaveLength(0)
    })
})

describe('Calendar API - mixed events and ordering', () => {
    it('returns mixed event types sorted ascending by date', async () => {
        const { token } = await seedUserDirectly({ email: 'calendar-mixed@example.com' })
        const account = await createTestAccount(token)

        await createRecurringRule(token, { title: 'Mid-month bill', accountId: account._id, nextDueDate: '2026-01-15' })
        await request(app)
            .post('/api/v1/budgets')
            .set(authHeader(token))
            .send({ periodType: 'monthly', year: 2026, month: 1, amount: 500 })
        await request(app)
            .post('/api/v1/savings-goals')
            .set(authHeader(token))
            .send({ name: 'Early goal', targetAmount: 100, targetDate: '2026-01-05' })

        const res = await getCalendar(token, '?start=2026-01-01&end=2026-01-31')
        expect(res.status).toBe(200)
        expect(res.body.data.length).toBeGreaterThanOrEqual(3)

        const dates = res.body.data.map((e: { date: string }) => e.date)
        const sorted = [...dates].sort()
        expect(dates).toEqual(sorted)
    })
})

describe('Calendar API - workspace scoping and isolation', () => {
    it('only includes workspace-scoped events for workspace members', async () => {
        const owner = await seedUserDirectly({ email: 'calendar-ws-owner@example.com' })

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
                title: 'Shared bill',
                type: 'expense',
                amount: 50,
                accountId: wsAccountRes.body.data._id,
                categoryId,
                interval: 'monthly',
                nextDueDate: daysFromNowStr(5),
                workspaceId,
            })

        await createRecurringRule(owner.token, { title: 'Personal bill', nextDueDate: daysFromNowStr(5) })

        const res = await getCalendar(owner.token, `?start=${daysFromNowStr(0)}&end=${daysFromNowStr(30)}&workspaceId=${workspaceId}`)
        const titles = res.body.data.map((e: { title: string }) => e.title)
        expect(titles).toContain('Shared bill')
        expect(titles).not.toContain('Personal bill')
    })

    it('does not leak another user calendar events', async () => {
        const owner = await seedUserDirectly({ email: 'calendar-owner@example.com' })
        const other = await seedUserDirectly({ email: 'calendar-other@example.com' })

        await createRecurringRule(owner.token, { title: 'Owner bill', nextDueDate: daysFromNowStr(5) })

        const res = await getCalendar(other.token, `?start=${daysFromNowStr(0)}&end=${daysFromNowStr(30)}`)
        expect(res.body.data).toHaveLength(0)
    })
})
