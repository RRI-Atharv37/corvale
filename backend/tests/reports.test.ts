import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import RecurringRule from '../models/RecurringRule'
import Transaction from '../models/Transaction'
import { authHeader, seedUserDirectly } from './helpers'

const JAN_2026_MONTHLY = { periodType: 'monthly', year: 2026, month: 1 }
const JAN_2026_CUSTOM = { periodType: 'custom', startDate: '2026-01-01', endDate: '2026-01-31' }

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

async function createRecurringRule(
    token: string,
    accountId: string,
    categoryId: string,
    overrides: Record<string, unknown> = {}
) {
    return request(app)
        .post('/api/v1/recurring-rules')
        .set(authHeader(token))
        .send({
            title: 'Netflix',
            type: 'expense',
            amount: 15.99,
            accountId,
            categoryId,
            interval: 'monthly',
            nextDueDate: '2026-02-01',
            ...overrides,
        })
}

async function seedReportFixture(token: string, userId?: string) {
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

    await createTransaction(token, {
        type: 'expense',
        title: 'Holiday gifts',
        amount: 200,
        date: '2025-12-20T12:00:00.000Z',
        accountId: account._id,
        categoryId: foodCategoryId,
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

    const recurringRes = await createRecurringRule(token, account._id, foodCategoryId)

    if (userId && recurringRes.body.data?._id) {
        await Transaction.create({
            userId,
            accountId: account._id,
            categoryId: foodCategoryId,
            type: 'expense',
            status: 'posted',
            amount: 1599,
            currency: 'USD',
            title: 'Posted recurring Netflix',
            date: new Date('2026-01-12T12:00:00.000Z'),
            recurringPaymentId: recurringRes.body.data._id,
        })
    }

    return { account, foodCategoryId, transportCategoryId, incomeCategoryId, recurringRuleId: recurringRes.body.data._id }
}

describe('Reports - auth', () => {
    it('returns 401 for unauthenticated report requests', async () => {
        const res = await request(app).get('/api/v1/dashboard/reports/averages')

        expect(res.status).toBe(401)
        expect(res.body.success).toBe(false)
    })
})

describe('Reports - period averages', () => {
    it('returns daily averages for a custom period', async () => {
        const { token } = await seedUserDirectly({ email: 'report-avg-custom@example.com' })
        await seedReportFixture(token)

        const res = await request(app)
            .get('/api/v1/dashboard/reports/averages')
            .query(JAN_2026_CUSTOM)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.totalIncome).toBe(3000)
        expect(res.body.data.totalExpenses).toBe(800)
        expect(res.body.data.netSavings).toBe(2200)
        expect(res.body.data.unit).toBe('day')
        expect(res.body.data.unitCount).toBe(31)
        expect(res.body.data.averageIncome).toBeCloseTo(3000 / 31, 2)
    })

    it('returns monthly averages for a yearly period', async () => {
        const { token } = await seedUserDirectly({ email: 'report-avg-yearly@example.com' })
        await seedReportFixture(token)

        const res = await request(app)
            .get('/api/v1/dashboard/reports/averages')
            .query({ periodType: 'yearly', year: 2026 })
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.periodType).toBe('yearly')
        expect(res.body.data.unit).toBe('month')
        expect(res.body.data.monthlyBreakdown).toBeDefined()
        expect(Array.isArray(res.body.data.monthlyBreakdown)).toBe(true)
    })

    it('returns monthly averages for a monthly period', async () => {
        const { token } = await seedUserDirectly({ email: 'report-avg-monthly@example.com' })
        await seedReportFixture(token)

        const res = await request(app)
            .get('/api/v1/dashboard/reports/averages')
            .query(JAN_2026_MONTHLY)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.periodStart).toBe('2026-01-01')
        expect(res.body.data.periodEnd).toBe('2026-01-31')
        expect(res.body.data.totalIncome).toBe(3000)
        expect(res.body.data.totalExpenses).toBe(800)
    })
})

describe('Reports - largest expenses', () => {
    it('returns posted expenses sorted by amount descending', async () => {
        const { token } = await seedUserDirectly({ email: 'report-largest@example.com' })
        await seedReportFixture(token)

        const res = await request(app)
            .get('/api/v1/dashboard/reports/largest-expenses')
            .query({ ...JAN_2026_MONTHLY, limit: 5 })
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.expenses).toHaveLength(2)
        expect(res.body.data.expenses[0].title).toBe('Groceries')
        expect(res.body.data.expenses[0].amount).toBe(500)
        expect(res.body.data.expenses[1].title).toBe('Bus pass')
        expect(res.body.data.expenses[1].amount).toBe(300)
    })
})

describe('Reports - spending trends', () => {
    it('returns month-over-month expense trends within a yearly period', async () => {
        const { token } = await seedUserDirectly({ email: 'report-trends@example.com' })
        await seedReportFixture(token)

        const res = await request(app)
            .get('/api/v1/dashboard/reports/spending-trends')
            .query({ periodType: 'yearly', year: 2025 })
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.trends.length).toBeGreaterThan(0)

        const december = res.body.data.trends.find(
            (point: { period: string }) => point.period === '2025-12'
        )
        expect(december?.expense).toBe(200)
        expect(december?.trend).toBe('flat')
    })
})

describe('Reports - income vs expense', () => {
    it('returns comparison ratios for the selected period', async () => {
        const { token } = await seedUserDirectly({ email: 'report-compare@example.com' })
        await seedReportFixture(token)

        const res = await request(app)
            .get('/api/v1/dashboard/reports/income-vs-expense')
            .query(JAN_2026_MONTHLY)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.totalIncome).toBe(3000)
        expect(res.body.data.totalExpenses).toBe(800)
        expect(res.body.data.netSavings).toBe(2200)
        expect(res.body.data.expenseToIncomeRatio).toBeCloseTo(800 / 3000, 2)
    })
})

describe('Reports - savings rate', () => {
    it('returns savings rate as a percentage of income', async () => {
        const { token } = await seedUserDirectly({ email: 'report-savings@example.com' })
        await seedReportFixture(token)

        const res = await request(app)
            .get('/api/v1/dashboard/reports/savings-rate')
            .query(JAN_2026_MONTHLY)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.totalIncome).toBe(3000)
        expect(res.body.data.totalExpenses).toBe(800)
        expect(res.body.data.netSavings).toBe(2200)
        expect(res.body.data.savingsRate).toBeCloseTo((2200 / 3000) * 100, 2)
    })
})

describe('Reports - recurring totals', () => {
    it('returns active recurring rules and posted recurring expenses in period', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'report-recurring@example.com' })
        await seedReportFixture(token, userId)

        const res = await request(app)
            .get('/api/v1/dashboard/reports/recurring-totals')
            .query(JAN_2026_MONTHLY)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.activeExpenseRules).toHaveLength(1)
        expect(res.body.data.activeExpenseRules[0].title).toBe('Netflix')
        expect(res.body.data.activeExpenseRules[0].monthlyEquivalent).toBe(15.99)
        expect(res.body.data.totalMonthlyEquivalent).toBe(15.99)
        expect(res.body.data.postedRecurringExpensesInPeriod).toBe(15.99)
    })
})

describe('Reports - budget analysis', () => {
    it('returns budget progress for budgets overlapping the period', async () => {
        const { token } = await seedUserDirectly({ email: 'report-budget@example.com' })
        await seedReportFixture(token)

        const res = await request(app)
            .get('/api/v1/dashboard/reports/budget-analysis')
            .query(JAN_2026_MONTHLY)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.budgets).toHaveLength(1)
        expect(res.body.data.budgets[0].budgetAmount).toBe(1000)
        expect(res.body.data.budgets[0].spent).toBe(800)
        expect(res.body.data.totalBudgeted).toBe(1000)
        expect(res.body.data.totalSpent).toBe(800)
        expect(res.body.data.overBudgetCount).toBe(0)
    })
})

describe('Reports - spending analysis', () => {
    it('returns aggregate spending metrics with top categories and trends', async () => {
        const { token } = await seedUserDirectly({ email: 'report-spending@example.com' })
        await seedReportFixture(token)

        const res = await request(app)
            .get('/api/v1/dashboard/reports/spending-analysis')
            .query({ ...JAN_2026_MONTHLY, limit: 5 })
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.totalExpenses).toBe(800)
        expect(res.body.data.transactionCount).toBe(2)
        expect(res.body.data.averagePerTransaction).toBe(400)
        expect(res.body.data.topCategories.length).toBeGreaterThan(0)
        expect(res.body.data.largestExpenses[0].amount).toBe(500)
        expect(Array.isArray(res.body.data.trends)).toBe(true)
    })
})

describe('Reports - crossover point', () => {
    it('detects when cumulative income crosses cumulative expenses', async () => {
        const { token } = await seedUserDirectly({ email: 'report-crossover@example.com' })
        await seedReportFixture(token)

        const res = await request(app)
            .get('/api/v1/dashboard/reports/crossover-point')
            .query(JAN_2026_MONTHLY)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.hasCrossover).toBe(true)
        expect(res.body.data.monthlyCrossoverPeriod).toBe('2026-01')
        expect(res.body.data.series.length).toBeGreaterThan(0)
    })
})

describe('Reports - custom query', () => {
    it('returns total split rows', async () => {
        const { token } = await seedUserDirectly({ email: 'report-query-total@example.com' })
        await seedReportFixture(token)

        const res = await request(app)
            .post('/api/v1/dashboard/reports/query')
            .set(authHeader(token))
            .send({
                ...JAN_2026_CUSTOM,
                splitBy: 'total',
                chartType: 'table',
                dataType: 'both',
            })

        expect(res.status).toBe(200)
        expect(res.body.data.splitBy).toBe('total')
        expect(res.body.data.rows).toHaveLength(1)
        expect(res.body.data.rows[0]).toMatchObject({
            label: 'Total',
            income: 3000,
            expense: 800,
            total: 3800,
        })
    })

    it('returns time-series rows grouped by month', async () => {
        const { token } = await seedUserDirectly({ email: 'report-query-time@example.com' })
        await seedReportFixture(token)

        const res = await request(app)
            .post('/api/v1/dashboard/reports/query')
            .set(authHeader(token))
            .send({
                ...JAN_2026_CUSTOM,
                splitBy: 'time',
                chartType: 'line',
                dataType: 'both',
                groupBy: 'month',
            })

        expect(res.status).toBe(200)
        expect(res.body.data.splitBy).toBe('time')
        expect(res.body.data.groupBy).toBe('month')
        expect(res.body.data.rows.some((row: { period?: string; label: string }) => row.label === '2026-01')).toBe(true)
    })

    it('returns category split rows for expenses', async () => {
        const { token } = await seedUserDirectly({ email: 'report-query-category@example.com' })
        await seedReportFixture(token)

        const res = await request(app)
            .post('/api/v1/dashboard/reports/query')
            .set(authHeader(token))
            .send({
                ...JAN_2026_CUSTOM,
                splitBy: 'category',
                chartType: 'donut',
                dataType: 'expense',
            })

        expect(res.status).toBe(200)
        expect(res.body.data.rows).toHaveLength(2)
        expect(res.body.data.rows[0].total).toBeGreaterThanOrEqual(res.body.data.rows[1].total)
    })

    it('returns payment method split rows', async () => {
        const { token } = await seedUserDirectly({ email: 'report-query-payment@example.com' })
        await seedReportFixture(token)

        const res = await request(app)
            .post('/api/v1/dashboard/reports/query')
            .set(authHeader(token))
            .send({
                ...JAN_2026_CUSTOM,
                splitBy: 'paymentMethod',
                chartType: 'bar',
                dataType: 'expense',
            })

        expect(res.status).toBe(200)
        expect(res.body.data.splitBy).toBe('paymentMethod')
        expect(Array.isArray(res.body.data.rows)).toBe(true)
    })
})

describe('Reports - generate (JSON and CSV)', () => {
    it('returns selected metrics as JSON', async () => {
        const { token } = await seedUserDirectly({ email: 'report-generate-json@example.com' })
        await seedReportFixture(token)

        const res = await request(app)
            .post('/api/v1/dashboard/reports/generate')
            .set(authHeader(token))
            .send({
                ...JAN_2026_MONTHLY,
                metrics: ['summary', 'savingsRate', 'largestExpenses', 'categoryBreakdown'],
                limit: 5,
            })

        expect(res.status).toBe(200)
        expect(res.body.data.periodType).toBe('monthly')
        expect(res.body.data.metrics.summary.totalIncome).toBe(3000)
        expect(res.body.data.metrics.savingsRate.savingsRate).toBeCloseTo((2200 / 3000) * 100, 2)
        expect(res.body.data.metrics.largestExpenses[0].amount).toBe(500)
        expect(res.body.data.metrics.categoryBreakdown.length).toBe(2)
    })

    it('exports selected metrics as CSV', async () => {
        const { token } = await seedUserDirectly({ email: 'report-generate-csv@example.com' })
        await seedReportFixture(token)

        const res = await request(app)
            .post('/api/v1/dashboard/reports/generate')
            .set(authHeader(token))
            .send({
                ...JAN_2026_MONTHLY,
                metrics: ['summary', 'savingsRate', 'largestExpenses'],
                format: 'csv',
            })

        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toMatch(/text\/csv/)
        expect(res.headers['content-disposition']).toMatch(/attachment/)
        expect(res.text).toContain('Section,Key,Value')
        expect(res.text).toContain('Summary,Total Income,3000')
        expect(res.text).toContain('Savings Rate,Rate (%),')
        expect(res.text).toContain('Largest Expenses,#1 Groceries,500')
    })

    it('exports selected metrics as JSON file', async () => {
        const { token } = await seedUserDirectly({ email: 'report-generate-json-file@example.com' })
        await seedReportFixture(token)

        const res = await request(app)
            .post('/api/v1/dashboard/reports/generate')
            .set(authHeader(token))
            .send({
                ...JAN_2026_MONTHLY,
                metrics: ['summary', 'savingsRate'],
                format: 'json',
            })

        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toMatch(/application\/json/)
        expect(res.headers['content-disposition']).toMatch(/attachment/)
        const payload = JSON.parse(res.text)
        expect(payload.metrics.summary.totalIncome).toBe(3000)
        expect(payload.metrics.savingsRate.savingsRate).toBeCloseTo((2200 / 3000) * 100, 2)
    })

    it('exports selected metrics as PDF', async () => {
        const { token } = await seedUserDirectly({ email: 'report-generate-pdf@example.com' })
        await seedReportFixture(token)

        const res = await request(app)
            .post('/api/v1/dashboard/reports/generate')
            .set(authHeader(token))
            .send({
                ...JAN_2026_MONTHLY,
                metrics: ['summary'],
                format: 'pdf',
            })

        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toMatch(/application\/pdf/)
        expect(res.headers['content-disposition']).toMatch(/attachment/)
        expect(res.body.subarray(0, 4).toString()).toBe('%PDF')
    })

    it('rejects unsupported export formats', async () => {
        const { token } = await seedUserDirectly({ email: 'report-generate-invalid-format@example.com' })
        await seedReportFixture(token)

        const res = await request(app)
            .post('/api/v1/dashboard/reports/generate')
            .set(authHeader(token))
            .send({
                ...JAN_2026_MONTHLY,
                metrics: ['summary'],
                format: 'doc',
            })

        expect(res.status).toBe(400)
    })

    it('rejects generate requests without metrics', async () => {
        const { token } = await seedUserDirectly({ email: 'report-generate-invalid@example.com' })

        const res = await request(app)
            .post('/api/v1/dashboard/reports/generate')
            .set(authHeader(token))
            .send(JAN_2026_MONTHLY)

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/metrics/i)
    })
})

describe('Reports - saved reports', () => {
    it('creates, lists, runs, updates, and deletes a saved report', async () => {
        const { token } = await seedUserDirectly({ email: 'report-saved@example.com' })
        await seedReportFixture(token)

        const createRes = await request(app)
            .post('/api/v1/dashboard/reports/saved')
            .set(authHeader(token))
            .send({
                name: 'January expense breakdown',
                periodType: 'monthly',
                year: 2026,
                month: 1,
                splitBy: 'category',
                chartType: 'donut',
                dataType: 'expense',
            })

        expect(createRes.status).toBe(201)
        const reportId = createRes.body.data._id

        const listRes = await request(app)
            .get('/api/v1/dashboard/reports/saved')
            .set(authHeader(token))

        expect(listRes.status).toBe(200)
        expect(listRes.body.data).toHaveLength(1)
        expect(listRes.body.data[0].name).toBe('January expense breakdown')

        const runRes = await request(app)
            .get(`/api/v1/dashboard/reports/saved/${reportId}/run`)
            .set(authHeader(token))

        expect(runRes.status).toBe(200)
        expect(runRes.body.data.result.splitBy).toBe('category')
        expect(runRes.body.data.result.rows.length).toBe(2)

        const updateRes = await request(app)
            .put(`/api/v1/dashboard/reports/saved/${reportId}`)
            .set(authHeader(token))
            .send({ name: 'Updated January report' })

        expect(updateRes.status).toBe(200)
        expect(updateRes.body.data.name).toBe('Updated January report')

        const deleteRes = await request(app)
            .delete(`/api/v1/dashboard/reports/saved/${reportId}`)
            .set(authHeader(token))

        expect(deleteRes.status).toBe(200)

        const afterDelete = await request(app)
            .get('/api/v1/dashboard/reports/saved')
            .set(authHeader(token))

        expect(afterDelete.body.data).toHaveLength(0)
    })

    it('returns 403 when another user runs a saved report', async () => {
        const owner = await seedUserDirectly({ email: 'report-saved-owner@example.com' })
        const other = await seedUserDirectly({ email: 'report-saved-other@example.com' })

        const createRes = await request(app)
            .post('/api/v1/dashboard/reports/saved')
            .set(authHeader(owner.token))
            .send({
                name: 'Private report',
                periodType: 'monthly',
                year: 2026,
                month: 1,
                splitBy: 'total',
                chartType: 'table',
                dataType: 'both',
            })

        const runRes = await request(app)
            .get(`/api/v1/dashboard/reports/saved/${createRes.body.data._id}/run`)
            .set(authHeader(other.token))

        expect(runRes.status).toBe(403)
    })
})

describe('Reports - user isolation and draft exclusion', () => {
    it('returns empty report data for a user with no transactions', async () => {
        const { token } = await seedUserDirectly({ email: 'report-empty@example.com' })
        await createTestAccount(token)

        const res = await request(app)
            .get('/api/v1/dashboard/reports/savings-rate')
            .query(JAN_2026_MONTHLY)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.totalIncome).toBe(0)
        expect(res.body.data.totalExpenses).toBe(0)
        expect(res.body.data.savingsRate).toBe(0)
    })

    it('excludes draft transactions from report totals', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'report-draft@example.com' })
        const { account, foodCategoryId } = await seedReportFixture(token)

        await Transaction.create({
            userId,
            accountId: account._id,
            categoryId: foodCategoryId,
            type: 'expense',
            status: 'draft',
            amount: 500000,
            currency: 'USD',
            title: 'Draft expense',
            date: new Date('2026-01-18T12:00:00.000Z'),
        })

        const res = await request(app)
            .get('/api/v1/dashboard/reports/savings-rate')
            .query(JAN_2026_MONTHLY)
            .set(authHeader(token))

        expect(res.body.data.totalExpenses).toBe(800)
    })

    it('does not include another user recurring rules in totals', async () => {
        const owner = await seedUserDirectly({ email: 'report-recur-owner@example.com' })
        const other = await seedUserDirectly({ email: 'report-recur-other@example.com' })

        const ownerAccount = await createTestAccount(owner.token)
        const ownerFood = await getFoodMasterId(owner.token)
        await createRecurringRule(owner.token, ownerAccount._id, ownerFood)

        const otherAccount = await createTestAccount(other.token)
        const otherFood = await getFoodMasterId(other.token)
        await createRecurringRule(other.token, otherAccount._id, otherFood, { title: 'Other rule' })

        const res = await request(app)
            .get('/api/v1/dashboard/reports/recurring-totals')
            .query(JAN_2026_MONTHLY)
            .set(authHeader(owner.token))

        expect(res.status).toBe(200)
        expect(res.body.data.activeExpenseRules).toHaveLength(1)
        expect(res.body.data.activeExpenseRules[0].title).toBe('Netflix')

        const otherRules = await RecurringRule.find({ userId: other.userId })
        expect(otherRules).toHaveLength(1)
    })
})
