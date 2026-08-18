import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import { authHeader, seedUserDirectly } from './helpers'

/**
 * Sprint 11.0 acceptance criteria for the cash flow forecast feature (11.1).
 *
 * Contract defined by these tests (implementation must satisfy):
 *   GET /api/v1/forecast?days=30|60|90&accountId=&workspaceId=
 *   -> { success, data: { days, startDate, endDate, accounts: [{
 *        accountId, accountName, currency, startingBalance, projectedEndingBalance,
 *        projectedChanges: [{ date, type: 'recurring'|'goal'|'discretionary', amount, label, refId? }],
 *        lowBalanceWarnings: [{ date, projectedBalance }]
 *      }] } }
 *
 * projectedChanges amounts are signed (income/positive inflow, expense/negative outflow),
 * sorted ascending by date. Discretionary spend is a single aggregated entry dated on the
 * forecast endDate: avgDailySpend (posted, non-transfer, non-recurring expenses over the
 * trailing 90 days, divided by 90) * days.
 */

function daysFromNowStr(offset: number): string {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + offset)
    return d.toISOString().slice(0, 10)
}

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const food = res.body.data.masters.find((m: { name: string }) => m.name === 'Food')
    return food._id
}

async function getIncomeMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const income = res.body.data.masters.find((m: { name: string }) => m.name === 'Income')
    return income._id
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

async function getForecast(token: string, query = '?days=30') {
    return request(app).get(`/api/v1/forecast${query}`).set(authHeader(token))
}

describe('Forecast API - validation and auth', () => {
    it('rejects unauthenticated requests', async () => {
        const res = await request(app).get('/api/v1/forecast')
        expect(res.status).toBe(401)
    })

    it('defaults to a 30-day window when days is omitted', async () => {
        const { token } = await seedUserDirectly({ email: 'forecast-default@example.com' })
        await createTestAccount(token)

        const res = await getForecast(token, '')
        expect(res.status).toBe(200)
        expect(res.body.data.days).toBe(30)
    })

    it('accepts 30, 60, and 90 day windows', async () => {
        const { token } = await seedUserDirectly({ email: 'forecast-windows@example.com' })
        await createTestAccount(token)

        for (const days of [30, 60, 90]) {
            const res = await getForecast(token, `?days=${days}`)
            expect(res.status).toBe(200)
            expect(res.body.data.days).toBe(days)
        }
    })

    it('rejects an unsupported days value', async () => {
        const { token } = await seedUserDirectly({ email: 'forecast-bad-days@example.com' })

        const res = await getForecast(token, '?days=45')
        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/days/i)
    })

    it('rejects a non-existent or non-owned accountId filter', async () => {
        const owner = await seedUserDirectly({ email: 'forecast-owner@example.com' })
        const other = await seedUserDirectly({ email: 'forecast-other@example.com' })
        const otherAccount = await createTestAccount(other.token)

        const res = await getForecast(owner.token, `?days=30&accountId=${otherAccount._id}`)
        expect(res.status).toBe(403)

        const missingRes = await getForecast(owner.token, '?days=30&accountId=507f1f77bcf86cd799439011')
        expect(missingRes.status).toBe(404)
    })
})

describe('Forecast API - projection with no activity', () => {
    it('projects a flat balance when there are no recurring rules or goals', async () => {
        const { token } = await seedUserDirectly({ email: 'forecast-flat@example.com' })
        const account = await createTestAccount(token, 'Checking', 500)

        const res = await getForecast(token, '?days=30')
        expect(res.status).toBe(200)

        const projected = res.body.data.accounts.find((a: { accountId: string }) => a.accountId === account._id)
        expect(projected.startingBalance).toBe(500)
        expect(projected.projectedEndingBalance).toBe(500)
        expect(projected.projectedChanges).toHaveLength(0)
        expect(projected.lowBalanceWarnings).toHaveLength(0)
    })

    it('returns 200 with an empty accounts array when the user has no accounts', async () => {
        const { token } = await seedUserDirectly({ email: 'forecast-no-accounts@example.com' })

        const res = await getForecast(token, '?days=30')
        expect(res.status).toBe(200)
        expect(res.body.data.accounts).toHaveLength(0)
    })
})

describe('Forecast API - recurring rule projection', () => {
    it('includes a single occurrence of a monthly expense rule due within the window', async () => {
        const { token } = await seedUserDirectly({ email: 'forecast-monthly@example.com' })
        const account = await createTestAccount(token, 'Checking', 1000)

        await createRecurringRule(token, {
            title: 'Rent',
            type: 'expense',
            amount: 200,
            accountId: account._id,
            interval: 'monthly',
            nextDueDate: daysFromNowStr(10),
        })

        const res = await getForecast(token, '?days=30')
        const projected = res.body.data.accounts.find((a: { accountId: string }) => a.accountId === account._id)

        const recurringChanges = projected.projectedChanges.filter(
            (c: { type: string }) => c.type === 'recurring'
        )
        expect(recurringChanges).toHaveLength(1)
        expect(recurringChanges[0].amount).toBe(-200)
        expect(recurringChanges[0].date).toBe(daysFromNowStr(10))
        expect(projected.projectedEndingBalance).toBe(800)
    })

    it('includes multiple occurrences of a weekly rule within a 30-day window', async () => {
        const { token } = await seedUserDirectly({ email: 'forecast-weekly@example.com' })
        const account = await createTestAccount(token, 'Checking', 1000)
        const categoryId = await getIncomeMasterId(token)

        await createRecurringRule(token, {
            title: 'Freelance income',
            type: 'income',
            amount: 50,
            accountId: account._id,
            categoryId,
            interval: 'weekly',
            nextDueDate: daysFromNowStr(1),
        })

        const res = await getForecast(token, '?days=30')
        const projected = res.body.data.accounts.find((a: { accountId: string }) => a.accountId === account._id)

        const recurringChanges = projected.projectedChanges.filter(
            (c: { type: string }) => c.type === 'recurring'
        )
        // occurrences at day+1, +8, +15, +22, +29 => 5 within a 30-day window
        expect(recurringChanges.length).toBeGreaterThanOrEqual(4)
        expect(recurringChanges.every((c: { amount: number }) => c.amount === 50)).toBe(true)
        expect(projected.projectedEndingBalance).toBe(1000 + recurringChanges.length * 50)
    })

    it('excludes inactive and archived recurring rules from the projection', async () => {
        const { token } = await seedUserDirectly({ email: 'forecast-inactive@example.com' })
        const account = await createTestAccount(token, 'Checking', 1000)

        const inactiveRes = await createRecurringRule(token, {
            title: 'Paused bill',
            accountId: account._id,
            nextDueDate: daysFromNowStr(5),
        })
        await request(app)
            .put(`/api/v1/recurring-rules/${inactiveRes.body.data._id}`)
            .set(authHeader(token))
            .send({ isActive: false })

        const archivedRes = await createRecurringRule(token, {
            title: 'Cancelled bill',
            accountId: account._id,
            nextDueDate: daysFromNowStr(6),
        })
        await request(app)
            .delete(`/api/v1/recurring-rules/${archivedRes.body.data._id}`)
            .set(authHeader(token))

        const res = await getForecast(token, '?days=30')
        const projected = res.body.data.accounts.find((a: { accountId: string }) => a.accountId === account._id)

        expect(projected.projectedChanges.filter((c: { type: string }) => c.type === 'recurring')).toHaveLength(0)
        expect(projected.projectedEndingBalance).toBe(1000)
    })

    it('excludes occurrences that fall outside the requested window', async () => {
        const { token } = await seedUserDirectly({ email: 'forecast-outside@example.com' })
        const account = await createTestAccount(token, 'Checking', 1000)

        await createRecurringRule(token, {
            title: 'Far future bill',
            accountId: account._id,
            interval: 'monthly',
            nextDueDate: daysFromNowStr(45),
        })

        const res = await getForecast(token, '?days=30')
        const projected = res.body.data.accounts.find((a: { accountId: string }) => a.accountId === account._id)

        expect(projected.projectedChanges.filter((c: { type: string }) => c.type === 'recurring')).toHaveLength(0)
        expect(projected.projectedEndingBalance).toBe(1000)
    })

    it('scopes the projection to accountId when provided', async () => {
        const { token } = await seedUserDirectly({ email: 'forecast-scoped@example.com' })
        const checking = await createTestAccount(token, 'Checking', 1000)
        const savingsRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Savings', type: 'savings', openingBalance: 200 })
        const savings = savingsRes.body.data

        await createRecurringRule(token, { title: 'Checking bill', accountId: checking._id, nextDueDate: daysFromNowStr(3) })
        await createRecurringRule(token, { title: 'Savings transfer bill', accountId: savings._id, nextDueDate: daysFromNowStr(3) })

        const res = await getForecast(token, `?days=30&accountId=${checking._id}`)
        expect(res.status).toBe(200)
        expect(res.body.data.accounts).toHaveLength(1)
        expect(res.body.data.accounts[0].accountId).toBe(checking._id)
    })
})

describe('Forecast API - savings goal auto-contributions', () => {
    it('deducts a scheduled goal auto-contribution from the linked account projection', async () => {
        const { token } = await seedUserDirectly({ email: 'forecast-goal@example.com' })
        const account = await createTestAccount(token, 'Checking', 1000)

        await request(app)
            .post('/api/v1/savings-goals')
            .set(authHeader(token))
            .send({
                name: 'Emergency fund',
                targetAmount: 5000,
                accountId: account._id,
                autoContribution: { enabled: true, amount: 100, interval: 'monthly' },
            })

        const res = await getForecast(token, '?days=30')
        const projected = res.body.data.accounts.find((a: { accountId: string }) => a.accountId === account._id)

        const goalChanges = projected.projectedChanges.filter((c: { type: string }) => c.type === 'goal')
        expect(goalChanges.length).toBeGreaterThanOrEqual(1)
        expect(goalChanges[0].amount).toBe(-100)
        expect(projected.projectedEndingBalance).toBeLessThan(1000)
    })

    it('ignores goals with auto-contribution disabled', async () => {
        const { token } = await seedUserDirectly({ email: 'forecast-goal-disabled@example.com' })
        const account = await createTestAccount(token, 'Checking', 1000)

        await request(app)
            .post('/api/v1/savings-goals')
            .set(authHeader(token))
            .send({ name: 'Vacation', targetAmount: 5000, accountId: account._id })

        const res = await getForecast(token, '?days=30')
        const projected = res.body.data.accounts.find((a: { accountId: string }) => a.accountId === account._id)

        expect(projected.projectedChanges.filter((c: { type: string }) => c.type === 'goal')).toHaveLength(0)
        expect(projected.projectedEndingBalance).toBe(1000)
    })
})

describe('Forecast API - discretionary spend average', () => {
    it('projects discretionary spend from trailing 90-day posted expense history', async () => {
        const { token } = await seedUserDirectly({ email: 'forecast-discretionary@example.com' })
        const account = await createTestAccount(token, 'Checking', 10000)
        const categoryId = await getFoodMasterId(token)

        // 900 total spend over the trailing window => avg $10/day => 30 days * $10 = $300 projected
        await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(token))
            .send({
                type: 'expense',
                title: 'Groceries',
                amount: 900,
                date: daysFromNowStr(-5),
                accountId: account._id,
                categoryId,
            })

        const res = await getForecast(token, '?days=30')
        const projected = res.body.data.accounts.find((a: { accountId: string }) => a.accountId === account._id)

        const discretionary = projected.projectedChanges.find((c: { type: string }) => c.type === 'discretionary')
        expect(discretionary).toBeDefined()
        expect(discretionary.amount).toBeCloseTo(-300, 0)
        expect(discretionary.date).toBe(daysFromNowStr(30))
    })

    it('excludes transfers and recurring-linked transactions from the discretionary average', async () => {
        const { token } = await seedUserDirectly({ email: 'forecast-discretionary-exclude@example.com' })
        const checking = await createTestAccount(token, 'Checking', 10000)
        const savingsRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Savings', type: 'savings', openingBalance: 0 })

        await request(app)
            .post('/api/v1/transactions/transfer')
            .set(authHeader(token))
            .send({
                title: 'Move to savings',
                amount: 500,
                date: daysFromNowStr(-2),
                fromAccountId: checking._id,
                toAccountId: savingsRes.body.data._id,
            })

        const res = await getForecast(token, '?days=30')
        const projected = res.body.data.accounts.find((a: { accountId: string }) => a.accountId === checking._id)

        const discretionary = projected.projectedChanges.find((c: { type: string }) => c.type === 'discretionary')
        expect(discretionary === undefined || discretionary.amount === 0).toBe(true)
    })
})

describe('Forecast API - low balance warnings', () => {
    it('emits a low balance warning when the projected balance goes negative', async () => {
        const { token } = await seedUserDirectly({ email: 'forecast-warning@example.com' })
        const account = await createTestAccount(token, 'Checking', 100)

        await createRecurringRule(token, {
            title: 'Big bill',
            type: 'expense',
            amount: 500,
            accountId: account._id,
            nextDueDate: daysFromNowStr(3),
        })

        const res = await getForecast(token, '?days=30')
        const projected = res.body.data.accounts.find((a: { accountId: string }) => a.accountId === account._id)

        expect(projected.projectedEndingBalance).toBeLessThan(0)
        expect(projected.lowBalanceWarnings.length).toBeGreaterThanOrEqual(1)
        expect(projected.lowBalanceWarnings[0]).toHaveProperty('date')
        expect(projected.lowBalanceWarnings[0]).toHaveProperty('projectedBalance')
    })

    it('does not emit warnings when the balance stays non-negative', async () => {
        const { token } = await seedUserDirectly({ email: 'forecast-no-warning@example.com' })
        const account = await createTestAccount(token, 'Checking', 1000)
        const categoryId = await getIncomeMasterId(token)

        await createRecurringRule(token, {
            title: 'Small bill',
            type: 'expense',
            amount: 20,
            accountId: account._id,
            nextDueDate: daysFromNowStr(3),
        })
        await createRecurringRule(token, {
            title: 'Paycheck',
            type: 'income',
            amount: 500,
            accountId: account._id,
            categoryId,
            nextDueDate: daysFromNowStr(1),
        })

        const res = await getForecast(token, '?days=30')
        const projected = res.body.data.accounts.find((a: { accountId: string }) => a.accountId === account._id)

        expect(projected.lowBalanceWarnings).toHaveLength(0)
    })
})

describe('Forecast API - workspace scoping', () => {
    it('only includes workspace accounts for members and excludes personal accounts', async () => {
        const owner = await seedUserDirectly({ email: 'forecast-ws-owner@example.com' })

        const wsRes = await request(app)
            .post('/api/v1/workspaces')
            .set(authHeader(owner.token))
            .send({ name: 'Household' })
        const workspaceId = wsRes.body.data._id

        const personalAccount = await createTestAccount(owner.token, 'Personal', 100)
        const wsAccountRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(owner.token))
            .send({ name: 'Shared', type: 'checking', openingBalance: 200, workspaceId })

        const res = await getForecast(owner.token, `?days=30&workspaceId=${workspaceId}`)
        expect(res.status).toBe(200)
        const ids = res.body.data.accounts.map((a: { accountId: string }) => a.accountId)
        expect(ids).toContain(wsAccountRes.body.data._id)
        expect(ids).not.toContain(personalAccount._id)
    })
})

describe('forecastUtils', () => {
    it('projects recurring occurrence dates within a range', async () => {
        const { projectRecurringOccurrences } = await import('../utils/forecastUtils')

        const start = new Date('2026-01-01T00:00:00.000Z')
        const end = new Date('2026-01-31T23:59:59.999Z')
        const occurrences = projectRecurringOccurrences(
            { nextDueDate: new Date('2026-01-05T00:00:00.000Z'), interval: 'weekly' } as never,
            start,
            end
        )

        expect(occurrences).toHaveLength(4)
        expect(occurrences[0].toISOString().slice(0, 10)).toBe('2026-01-05')
        expect(occurrences[3].toISOString().slice(0, 10)).toBe('2026-01-26')
    })

    it('computes a discretionary daily average from minor-unit historical spend', async () => {
        const { computeDiscretionaryDailyAverage } = await import('../utils/forecastUtils')

        expect(computeDiscretionaryDailyAverage(9000, 90)).toBe(100)
        expect(computeDiscretionaryDailyAverage(0, 90)).toBe(0)
    })
})
