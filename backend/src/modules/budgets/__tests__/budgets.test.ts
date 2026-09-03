import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Transaction } from '@modules/transactions'
import { authHeader, seedUserDirectly } from '@tests/helpers'

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

async function createTestAccount(token: string, name = 'Checking', openingBalance = 1000) {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'checking', openingBalance })

    return res.body.data
}

async function createTestExpense(
    token: string,
    payload: {
        title: string
        amount: number
        date: string
        accountId: string
        categoryId: string
    }
) {
    return request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({ type: 'expense', ...payload })
}

async function createMonthlyBudget(
    token: string,
    overrides: Record<string, unknown> = {}
) {
    return request(app)
        .post('/api/v1/budgets')
        .set(authHeader(token))
        .send({
            periodType: 'monthly',
            year: 2026,
            month: 1,
            amount: 500,
            ...overrides,
        })
}

describe('Budgets - CRUD and ownership', () => {
    it('creates a monthly overall budget with progress', async () => {
        const { token } = await seedUserDirectly({ email: 'budget-create-overall@example.com' })

        const res = await createMonthlyBudget(token, {
            name: 'January overall',
            amount: 1000,
            categoryId: null,
        })

        expect(res.status).toBe(201)
        expect(res.body.success).toBe(true)
        expect(res.body.data.name).toBe('January overall')
        expect(res.body.data.periodType).toBe('monthly')
        expect(res.body.data.categoryId).toBeNull()
        expect(res.body.data.amount).toBe(1000)
        expect(res.body.data.isArchived).toBe(false)
        expect(res.body.data.progress).toMatchObject({
            spent: 0,
            remaining: 1000,
            percentUsed: 0,
            isOverBudget: false,
            budgetAmount: 1000,
        })
    })

    it('creates a category-scoped monthly budget', async () => {
        const { token } = await seedUserDirectly({ email: 'budget-create-category@example.com' })
        const categoryId = await getFoodMasterId(token)

        const res = await createMonthlyBudget(token, {
            name: 'Food budget',
            amount: 200,
            categoryId,
        })

        expect(res.status).toBe(201)
        expect(res.body.data.categoryId).toBe(categoryId)
        expect(res.body.data.amount).toBe(200)
    })

    it('creates a custom period budget', async () => {
        const { token } = await seedUserDirectly({ email: 'budget-create-custom@example.com' })

        const res = await request(app)
            .post('/api/v1/budgets')
            .set(authHeader(token))
            .send({
                periodType: 'custom',
                periodStart: '2026-01-10',
                periodEnd: '2026-01-20',
                amount: 150,
            })

        expect(res.status).toBe(201)
        expect(res.body.data.periodType).toBe('custom')
        expect(res.body.data.periodStart).toBeDefined()
        expect(res.body.data.periodEnd).toBeDefined()
    })

    it('lists only the authenticated user budgets', async () => {
        const owner = await seedUserDirectly({ email: 'budget-list-owner@example.com' })
        const other = await seedUserDirectly({ email: 'budget-list-other@example.com' })

        await createMonthlyBudget(owner.token, { name: 'Owner budget' })
        await createMonthlyBudget(other.token, { name: 'Other budget' })

        const res = await request(app).get('/api/v1/budgets').set(authHeader(owner.token))

        expect(res.status).toBe(200)
        expect(res.body.data).toHaveLength(1)
        expect(res.body.data[0].name).toBe('Owner budget')
    })

    it('filters budgets by category and overall scope', async () => {
        const { token } = await seedUserDirectly({ email: 'budget-filter@example.com' })
        const foodCategoryId = await getFoodMasterId(token)

        await createMonthlyBudget(token, { name: 'Overall', categoryId: null })
        await createMonthlyBudget(token, { name: 'Food', categoryId: foodCategoryId })

        const overallRes = await request(app)
            .get('/api/v1/budgets?overall=true')
            .set(authHeader(token))

        expect(overallRes.body.data).toHaveLength(1)
        expect(overallRes.body.data[0].name).toBe('Overall')

        const categoryRes = await request(app)
            .get(`/api/v1/budgets?categoryId=${foodCategoryId}`)
            .set(authHeader(token))

        expect(categoryRes.body.data).toHaveLength(1)
        expect(categoryRes.body.data[0].name).toBe('Food')
    })

    it('gets a budget by id and dedicated progress endpoint', async () => {
        const { token } = await seedUserDirectly({ email: 'budget-get@example.com' })
        const createRes = await createMonthlyBudget(token, { amount: 300 })
        const budgetId = createRes.body.data._id

        const getRes = await request(app)
            .get(`/api/v1/budgets/${budgetId}`)
            .set(authHeader(token))

        expect(getRes.status).toBe(200)
        expect(getRes.body.data._id).toBe(budgetId)
        expect(getRes.body.data.progress.budgetAmount).toBe(300)

        const progressRes = await request(app)
            .get(`/api/v1/budgets/${budgetId}/progress`)
            .set(authHeader(token))

        expect(progressRes.status).toBe(200)
        expect(progressRes.body.data.budgetAmount).toBe(300)
        expect(progressRes.body.data.spent).toBe(0)
    })

    it('updates budget amount and account scoping', async () => {
        const { token } = await seedUserDirectly({ email: 'budget-update@example.com' })
        const account = await createTestAccount(token, 'Primary')
        const createRes = await createMonthlyBudget(token, { amount: 400 })
        const budgetId = createRes.body.data._id

        const res = await request(app)
            .put(`/api/v1/budgets/${budgetId}`)
            .set(authHeader(token))
            .send({
                amount: 600,
                name: 'Updated budget',
                accountIds: [account._id],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.amount).toBe(600)
        expect(res.body.data.name).toBe('Updated budget')
        expect(res.body.data.accountIds).toHaveLength(1)
        expect(res.body.data.accountIds[0]).toBe(account._id)
    })

    it('archives a budget and excludes it from default list', async () => {
        const { token } = await seedUserDirectly({ email: 'budget-archive@example.com' })
        const createRes = await createMonthlyBudget(token)
        const budgetId = createRes.body.data._id

        const archiveRes = await request(app)
            .delete(`/api/v1/budgets/${budgetId}`)
            .set(authHeader(token))

        expect(archiveRes.status).toBe(200)
        expect(archiveRes.body.data.data.isArchived).toBe(true)

        const listRes = await request(app).get('/api/v1/budgets').set(authHeader(token))
        expect(listRes.body.data).toHaveLength(0)

        const archivedListRes = await request(app)
            .get('/api/v1/budgets?includeArchived=true')
            .set(authHeader(token))

        expect(archivedListRes.body.data).toHaveLength(1)
        expect(archivedListRes.body.data[0].isArchived).toBe(true)
    })

    it('returns 403 when accessing another user budget', async () => {
        const owner = await seedUserDirectly({ email: 'budget-owner@example.com' })
        const other = await seedUserDirectly({ email: 'budget-other@example.com' })

        const createRes = await createMonthlyBudget(owner.token)
        const budgetId = createRes.body.data._id

        const getRes = await request(app)
            .get(`/api/v1/budgets/${budgetId}`)
            .set(authHeader(other.token))

        expect(getRes.status).toBe(403)

        const updateRes = await request(app)
            .put(`/api/v1/budgets/${budgetId}`)
            .set(authHeader(other.token))
            .send({ amount: 999 })

        expect(updateRes.status).toBe(403)
    })

    it('rejects invalid account ids on create', async () => {
        const { token } = await seedUserDirectly({ email: 'budget-invalid-account@example.com' })
        const other = await seedUserDirectly({ email: 'budget-invalid-account-other@example.com' })
        const otherAccount = await createTestAccount(other.token, 'Other account')

        const res = await createMonthlyBudget(token, {
            accountIds: [otherAccount._id],
        })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/invalid or not owned/i)
    })

    it('rejects update on an archived budget', async () => {
        const { token } = await seedUserDirectly({ email: 'budget-archived-update@example.com' })
        const createRes = await createMonthlyBudget(token)
        const budgetId = createRes.body.data._id

        await request(app).delete(`/api/v1/budgets/${budgetId}`).set(authHeader(token))

        const res = await request(app)
            .put(`/api/v1/budgets/${budgetId}`)
            .set(authHeader(token))
            .send({ amount: 100 })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/archived/i)
    })

    it('rejects invalid budget amount', async () => {
        const { token } = await seedUserDirectly({ email: 'budget-invalid-amount@example.com' })

        const res = await createMonthlyBudget(token, { amount: 0 })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/invalid budget amount/i)
    })
})

describe('Budgets - progress calculations', () => {
    it('counts posted expenses in period for category budgets', async () => {
        const { token } = await seedUserDirectly({ email: 'budget-category-progress@example.com' })
        const account = await createTestAccount(token)
        const foodCategoryId = await getFoodMasterId(token)
        const transportCategoryId = await getTransportMasterId(token)

        await createTestExpense(token, {
            title: 'Groceries',
            amount: 75,
            date: '2026-01-10T12:00:00.000Z',
            accountId: account._id,
            categoryId: foodCategoryId,
        })

        await createTestExpense(token, {
            title: 'Bus fare',
            amount: 25,
            date: '2026-01-12T12:00:00.000Z',
            accountId: account._id,
            categoryId: transportCategoryId,
        })

        const createRes = await createMonthlyBudget(token, {
            amount: 200,
            categoryId: foodCategoryId,
        })

        expect(createRes.body.data.progress.spent).toBe(75)
        expect(createRes.body.data.progress.remaining).toBe(125)
        expect(createRes.body.data.progress.percentUsed).toBe(37.5)
        expect(createRes.body.data.progress.isOverBudget).toBe(false)
    })

    it('counts all posted expenses for overall budgets excluding split parents', async () => {
        const { token } = await seedUserDirectly({ email: 'overall-progress@example.com' })
        const account = await createTestAccount(token)
        const foodCategoryId = await getFoodMasterId(token)
        const transportCategoryId = await getTransportMasterId(token)

        await createTestExpense(token, {
            title: 'Regular expense',
            amount: 50,
            date: '2026-01-05T12:00:00.000Z',
            accountId: account._id,
            categoryId: foodCategoryId,
        })

        await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(token))
            .send({
                type: 'expense',
                title: 'Split trip',
                amount: 100,
                date: '2026-01-08T12:00:00.000Z',
                accountId: account._id,
                splits: [
                    { categoryId: foodCategoryId, amount: 60 },
                    { categoryId: transportCategoryId, amount: 40 },
                ],
            })

        const createRes = await createMonthlyBudget(token, {
            amount: 500,
            categoryId: null,
        })

        expect(createRes.body.data.progress.spent).toBe(150)
    })

    it('scopes spending to selected accounts only', async () => {
        const { token } = await seedUserDirectly({ email: 'account-scope@example.com' })
        const primary = await createTestAccount(token, 'Primary', 1000)
        const secondary = await createTestAccount(token, 'Secondary', 1000)
        const foodCategoryId = await getFoodMasterId(token)

        await createTestExpense(token, {
            title: 'Primary spend',
            amount: 80,
            date: '2026-01-06T12:00:00.000Z',
            accountId: primary._id,
            categoryId: foodCategoryId,
        })

        await createTestExpense(token, {
            title: 'Secondary spend',
            amount: 120,
            date: '2026-01-07T12:00:00.000Z',
            accountId: secondary._id,
            categoryId: foodCategoryId,
        })

        const createRes = await createMonthlyBudget(token, {
            amount: 300,
            categoryId: null,
            accountIds: [primary._id],
        })

        expect(createRes.body.data.progress.spent).toBe(80)
    })

    it('excludes expenses outside the budget period', async () => {
        const { token } = await seedUserDirectly({ email: 'period-scope@example.com' })
        const account = await createTestAccount(token)
        const foodCategoryId = await getFoodMasterId(token)

        await createTestExpense(token, {
            title: 'In period',
            amount: 40,
            date: '2026-01-15T12:00:00.000Z',
            accountId: account._id,
            categoryId: foodCategoryId,
        })

        await createTestExpense(token, {
            title: 'Out of period',
            amount: 200,
            date: '2026-02-05T12:00:00.000Z',
            accountId: account._id,
            categoryId: foodCategoryId,
        })

        const createRes = await createMonthlyBudget(token, {
            amount: 100,
            categoryId: foodCategoryId,
        })

        expect(createRes.body.data.progress.spent).toBe(40)
    })
})

describe('Budgets - draft exclusion and over-budget state', () => {
    it('excludes draft transactions from spent totals', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'draft-exclude@example.com' })
        const account = await createTestAccount(token)
        const foodCategoryId = await getFoodMasterId(token)

        await createTestExpense(token, {
            title: 'Posted expense',
            amount: 30,
            date: '2026-01-10T12:00:00.000Z',
            accountId: account._id,
            categoryId: foodCategoryId,
        })

        await Transaction.create({
            userId,
            accountId: account._id,
            categoryId: foodCategoryId,
            type: 'expense',
            status: 'draft',
            amount: 5000,
            currency: 'USD',
            title: 'Draft bill',
            date: new Date('2026-01-11T12:00:00.000Z'),
        })

        const createRes = await createMonthlyBudget(token, {
            amount: 100,
            categoryId: foodCategoryId,
        })

        expect(createRes.body.data.progress.spent).toBe(30)
    })

    it('detects over-budget state with percent used above 100', async () => {
        const { token } = await seedUserDirectly({ email: 'over-budget@example.com' })
        const account = await createTestAccount(token)
        const foodCategoryId = await getFoodMasterId(token)

        await createTestExpense(token, {
            title: 'Big purchase',
            amount: 150,
            date: '2026-01-14T12:00:00.000Z',
            accountId: account._id,
            categoryId: foodCategoryId,
        })

        const createRes = await createMonthlyBudget(token, {
            amount: 100,
            categoryId: foodCategoryId,
        })

        expect(createRes.body.data.progress.spent).toBe(150)
        expect(createRes.body.data.progress.remaining).toBe(-50)
        expect(createRes.body.data.progress.percentUsed).toBe(150)
        expect(createRes.body.data.progress.isOverBudget).toBe(true)
    })

    it('excludes transfers from budget spent totals', async () => {
        const { token } = await seedUserDirectly({ email: 'transfer-exclude@example.com' })
        const fromAccount = await createTestAccount(token, 'Checking', 500)
        const toAccount = await createTestAccount(token, 'Savings', 100)
        const foodCategoryId = await getFoodMasterId(token)

        await createTestExpense(token, {
            title: 'Actual expense',
            amount: 25,
            date: '2026-01-09T12:00:00.000Z',
            accountId: fromAccount._id,
            categoryId: foodCategoryId,
        })

        await request(app)
            .post('/api/v1/transactions/transfer')
            .set(authHeader(token))
            .send({
                title: 'Move funds',
                amount: 100,
                date: '2026-01-10T12:00:00.000Z',
                fromAccountId: fromAccount._id,
                toAccountId: toAccount._id,
            })

        const createRes = await createMonthlyBudget(token, {
            amount: 200,
            categoryId: null,
        })

        expect(createRes.body.data.progress.spent).toBe(25)
    })
})

describe('Budgets - split transaction attribution', () => {
    it('attributes split child lines to matching category budgets', async () => {
        const { token } = await seedUserDirectly({ email: 'split-category@example.com' })
        const account = await createTestAccount(token)
        const foodCategoryId = await getFoodMasterId(token)
        const transportCategoryId = await getTransportMasterId(token)

        await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(token))
            .send({
                type: 'expense',
                title: 'Mixed trip',
                amount: 100,
                date: '2026-01-05T12:00:00.000Z',
                accountId: account._id,
                splits: [
                    { categoryId: foodCategoryId, amount: 60 },
                    { categoryId: transportCategoryId, amount: 40 },
                ],
            })

        const foodBudgetRes = await createMonthlyBudget(token, {
            amount: 200,
            categoryId: foodCategoryId,
        })

        const transportBudgetRes = await createMonthlyBudget(token, {
            amount: 200,
            categoryId: transportCategoryId,
        })

        expect(foodBudgetRes.body.data.progress.spent).toBe(60)
        expect(transportBudgetRes.body.data.progress.spent).toBe(40)
    })

    it('does not double-count split children in overall budgets', async () => {
        const { token } = await seedUserDirectly({ email: 'split-overall@example.com' })
        const account = await createTestAccount(token)
        const foodCategoryId = await getFoodMasterId(token)
        const transportCategoryId = await getTransportMasterId(token)

        await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(token))
            .send({
                type: 'expense',
                title: 'Split only',
                amount: 100,
                date: '2026-01-06T12:00:00.000Z',
                accountId: account._id,
                splits: [
                    { categoryId: foodCategoryId, amount: 70 },
                    { categoryId: transportCategoryId, amount: 30 },
                ],
            })

        const createRes = await createMonthlyBudget(token, {
            amount: 500,
            categoryId: null,
        })

        expect(createRes.body.data.progress.spent).toBe(100)
    })
})

describe('budgetUtils', () => {
    it('computes progress from minor units', async () => {
        const { computeBudgetProgress } = await import('@modules/budgets/budgetUtils')

        const under = computeBudgetProgress(10000, 7500)
        expect(under.spent).toBe(75)
        expect(under.remaining).toBe(25)
        expect(under.percentUsed).toBe(75)
        expect(under.isOverBudget).toBe(false)

        const over = computeBudgetProgress(10000, 12500)
        expect(over.spent).toBe(125)
        expect(over.remaining).toBe(-25)
        expect(over.percentUsed).toBe(125)
        expect(over.isOverBudget).toBe(true)
    })

    it('resolves monthly and custom periods in UTC', async () => {
        const { resolveMonthlyPeriod, resolveCustomPeriod } = await import('@modules/budgets/budgetUtils')

        const monthly = resolveMonthlyPeriod(2026, 1, 'UTC')
        expect(monthly.periodStart.toISOString()).toBe('2026-01-01T00:00:00.000Z')
        expect(monthly.periodEnd.toISOString()).toBe('2026-01-31T23:59:59.999Z')

        const custom = resolveCustomPeriod('2026-01-10', '2026-01-15', 'UTC')
        expect(custom.periodStart.toISOString()).toBe('2026-01-10T00:00:00.000Z')
        expect(custom.periodEnd.toISOString()).toBe('2026-01-15T23:59:59.999Z')
    })
})
