import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Transaction } from '@modules/transactions'
import { authHeader, seedUserDirectly } from './helpers'

const JAN_2026 = { startDate: '2026-01-01', endDate: '2026-01-31' }

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const food = res.body.data.masters.find((m: { name: string }) => m.name === 'Food')
    if (!food) {
        throw new Error('Food master category not found')
    }
    return food._id
}

async function getTransportMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const transport = res.body.data.masters.find((m: { name: string }) => m.name === 'Transport')
    if (!transport) {
        throw new Error('Transport master category not found')
    }
    return transport._id
}

async function getIncomeMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const income = res.body.data.masters.find((m: { name: string }) => m.name === 'Income')
    if (!income) {
        throw new Error('Income master category not found')
    }
    return income._id
}

async function createTestAccount(token: string, name = 'Checking', openingBalance = 5000) {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'checking', openingBalance })

    return res.body.data
}

async function createTransaction(
    token: string,
    payload: {
        type: 'income' | 'expense'
        title: string
        amount: number
        date: string
        accountId: string
        categoryId: string
    }
) {
    return request(app).post('/api/v1/transactions').set(authHeader(token)).send(payload)
}

async function seedJanuaryAnalytics(token: string) {
    const account = await createTestAccount(token)
    const incomeCategoryId = await getIncomeMasterId(token)
    const foodCategoryId = await getFoodMasterId(token)
    const transportCategoryId = await getTransportMasterId(token)

    await createTransaction(token, {
        type: 'income',
        title: 'Salary',
        amount: 3000,
        date: '2026-01-05T12:00:00.000Z',
        accountId: account._id,
        categoryId: incomeCategoryId,
    })

    await createTransaction(token, {
        type: 'expense',
        title: 'Groceries',
        amount: 500,
        date: '2026-01-10T12:00:00.000Z',
        accountId: account._id,
        categoryId: foodCategoryId,
    })

    await createTransaction(token, {
        type: 'expense',
        title: 'Bus pass',
        amount: 300,
        date: '2026-01-15T12:00:00.000Z',
        accountId: account._id,
        categoryId: transportCategoryId,
    })

    await request(app)
        .post('/api/v1/budgets')
        .set(authHeader(token))
        .send({
            periodType: 'monthly',
            year: 2026,
            month: 1,
            amount: 1000,
            name: 'January overall',
        })

    return { account, foodCategoryId, transportCategoryId, incomeCategoryId }
}

describe('Dashboard analytics - auth', () => {
    it('returns 401 for unauthenticated dashboard requests', async () => {
        const res = await request(app).get('/api/v1/dashboard/summary')

        expect(res.status).toBe(401)
        expect(res.body.success).toBe(false)
    })
})

describe('Dashboard analytics - summary', () => {
    it('returns period totals and net savings for a custom date range', async () => {
        const { token } = await seedUserDirectly({ email: 'dash-summary@example.com' })
        await seedJanuaryAnalytics(token)

        const res = await request(app)
            .get('/api/v1/dashboard/summary')
            .query(JAN_2026)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data.totalIncome).toBe(3000)
        expect(res.body.data.totalExpenses).toBe(800)
        expect(res.body.data.netSavings).toBe(2200)
        expect(res.body.data.incomeTransactionCount).toBe(1)
        expect(res.body.data.expenseTransactionCount).toBe(2)
        expect(res.body.data.periodStart).toBe(JAN_2026.startDate)
        expect(res.body.data.periodEnd).toBe(JAN_2026.endDate)
        expect(res.body.data.balanceSource).toBe('accounts')
        expect(typeof res.body.data.netWorth).toBe('number')
    })

    it('returns zero totals when no transactions exist in range', async () => {
        const { token } = await seedUserDirectly({ email: 'dash-empty@example.com' })
        await createTestAccount(token)

        const res = await request(app)
            .get('/api/v1/dashboard/summary')
            .query(JAN_2026)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.totalIncome).toBe(0)
        expect(res.body.data.totalExpenses).toBe(0)
        expect(res.body.data.netSavings).toBe(0)
    })
})

describe('Dashboard analytics - cash flow', () => {
    it('returns grouped income, expense, and net series', async () => {
        const { token } = await seedUserDirectly({ email: 'dash-cashflow@example.com' })
        await seedJanuaryAnalytics(token)

        const res = await request(app)
            .get('/api/v1/dashboard/cash-flow')
            .query({ ...JAN_2026, groupBy: 'month' })
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.groupBy).toBe('month')
        expect(res.body.data.series).toHaveLength(1)
        expect(res.body.data.series[0]).toMatchObject({
            period: '2026-01',
            income: 3000,
            expense: 800,
            net: 2200,
        })
    })

    it('rejects invalid groupBy values', async () => {
        const { token } = await seedUserDirectly({ email: 'dash-groupby@example.com' })

        const res = await request(app)
            .get('/api/v1/dashboard/cash-flow')
            .query({ ...JAN_2026, groupBy: 'quarter' })
            .set(authHeader(token))

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/groupBy/i)
    })
})

describe('Dashboard analytics - category breakdown', () => {
    it('returns expense totals grouped by category', async () => {
        const { token } = await seedUserDirectly({ email: 'dash-cat-expense@example.com' })
        await seedJanuaryAnalytics(token)

        const res = await request(app)
            .get('/api/v1/dashboard/category-breakdown')
            .query({ ...JAN_2026, type: 'expense' })
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.type).toBe('expense')
        expect(res.body.data.breakdown).toHaveLength(2)

        const food = res.body.data.breakdown.find(
            (item: { categoryName: string }) => item.categoryName === 'Food'
        )
        const transport = res.body.data.breakdown.find(
            (item: { categoryName: string }) => item.categoryName === 'Transport'
        )

        expect(food?.amount).toBe(500)
        expect(transport?.amount).toBe(300)
    })

    it('returns income totals grouped by category', async () => {
        const { token } = await seedUserDirectly({ email: 'dash-cat-income@example.com' })
        await seedJanuaryAnalytics(token)

        const res = await request(app)
            .get('/api/v1/dashboard/category-breakdown')
            .query({ ...JAN_2026, type: 'income' })
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.type).toBe('income')
        expect(res.body.data.breakdown).toHaveLength(1)
        expect(res.body.data.breakdown[0].categoryName).toBe('Income')
        expect(res.body.data.breakdown[0].amount).toBe(3000)
    })

    it('defaults to expense breakdown when type is omitted', async () => {
        const { token } = await seedUserDirectly({ email: 'dash-cat-default@example.com' })
        await seedJanuaryAnalytics(token)

        const res = await request(app)
            .get('/api/v1/dashboard/category-breakdown')
            .query(JAN_2026)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.type).toBe('expense')
    })
})

describe('Dashboard analytics - net worth trend', () => {
    it('returns cumulative series and current balance breakdown', async () => {
        const { token } = await seedUserDirectly({ email: 'dash-networth@example.com' })
        await seedJanuaryAnalytics(token)

        const res = await request(app)
            .get('/api/v1/dashboard/net-worth-trend')
            .query(JAN_2026)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.series.length).toBeGreaterThan(0)
        expect(res.body.data.currentBalances).toMatchObject({
            liquid: expect.any(Number),
            savings: expect.any(Number),
            credit: expect.any(Number),
            spendable: expect.any(Number),
            netWorth: expect.any(Number),
        })
        expect(res.body.data.periodStart).toBe(JAN_2026.startDate)
        expect(res.body.data.periodEnd).toBe(JAN_2026.endDate)
    })
})

describe('Dashboard analytics - budget overview', () => {
    it('returns current-month budget progress items', async () => {
        const { token } = await seedUserDirectly({ email: 'dash-budget@example.com' })
        const account = await createTestAccount(token)
        const foodCategoryId = await getFoodMasterId(token)
        const now = new Date()
        const year = now.getUTCFullYear()
        const month = now.getUTCMonth() + 1
        const midMonthDate = `${year}-${String(month).padStart(2, '0')}-10T12:00:00.000Z`

        await createTransaction(token, {
            type: 'expense',
            title: 'Groceries',
            amount: 250,
            date: midMonthDate,
            accountId: account._id,
            categoryId: foodCategoryId,
        })

        await request(app)
            .post('/api/v1/budgets')
            .set(authHeader(token))
            .send({
                periodType: 'monthly',
                year,
                month,
                amount: 500,
                name: 'Current month overall',
            })

        const res = await request(app).get('/api/v1/dashboard/budget-overview').set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.budgets.length).toBeGreaterThan(0)
        expect(res.body.data.budgets[0]).toMatchObject({
            budgetAmount: 500,
            spent: 250,
            remaining: 250,
            isOverBudget: false,
        })
        expect(res.body.data.periodStart).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(res.body.data.periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
})

describe('Dashboard analytics - draft exclusion and user isolation', () => {
    it('excludes draft transactions from dashboard totals', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'dash-draft@example.com' })
        const { account, foodCategoryId } = await seedJanuaryAnalytics(token)

        await Transaction.create({
            userId,
            accountId: account._id,
            categoryId: foodCategoryId,
            type: 'expense',
            status: 'draft',
            amount: 999900,
            currency: 'USD',
            title: 'Draft bill',
            date: new Date('2026-01-20T12:00:00.000Z'),
        })

        const res = await request(app)
            .get('/api/v1/dashboard/summary')
            .query(JAN_2026)
            .set(authHeader(token))

        expect(res.body.data.totalExpenses).toBe(800)
    })

    it('returns only the authenticated user analytics data', async () => {
        const owner = await seedUserDirectly({ email: 'dash-owner@example.com' })
        const other = await seedUserDirectly({ email: 'dash-other@example.com' })

        await seedJanuaryAnalytics(owner.token)
        await createTestAccount(other.token)

        const res = await request(app)
            .get('/api/v1/dashboard/summary')
            .query(JAN_2026)
            .set(authHeader(other.token))

        expect(res.status).toBe(200)
        expect(res.body.data.totalIncome).toBe(0)
        expect(res.body.data.totalExpenses).toBe(0)
    })
})
