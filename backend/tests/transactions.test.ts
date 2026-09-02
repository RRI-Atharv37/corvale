import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import Account from '../models/Account'
import Transaction from '../models/Transaction'
import User from '../models/User'
import { authHeader, createSecondUser, registerUser, seedUserDirectly } from './helpers'

async function getIncomeMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const income = res.body.data.masters.find((m: { name: string }) => m.name === 'Income')
    if (!income) {
        throw new Error('Income master category not found')
    }
    return income._id
}

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const food = res.body.data.masters.find((m: { name: string }) => m.name === 'Food')
    if (!food) {
        throw new Error('Food master category not found')
    }
    return food._id
}

async function createTestAccount(token: string, openingBalance = 1000) {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({
            name: 'Checking',
            type: 'checking',
            openingBalance,
        })

    return res.body.data
}

interface TransactionPayload {
    type: 'income' | 'expense'
    title: string
    amount: number
    date: string
    accountId: string
    categoryId: string
    description?: string
}

async function createTestTransaction(token: string, payload: TransactionPayload) {
    const res = await request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send(payload)

    return res
}

describe('Transactions', () => {
    it('creates an income transaction and updates account balance', async () => {
        const { token } = await registerUser(app)
        const account = await createTestAccount(token, 500)
        const categoryId = await getIncomeMasterId(token)

        const res = await createTestTransaction(token, {
            type: 'income',
            title: 'Paycheck',
            amount: 250.5,
            date: '2026-01-15T12:00:00.000Z',
            accountId: account._id,
            categoryId,
            description: 'Monthly salary',
        })

        expect(res.status).toBe(201)
        expect(res.body.data.type).toBe('income')
        expect(res.body.data.amount).toBe(250.5)
        expect(res.body.data.currency).toBe('USD')
        expect(res.body.data.status).toBe('posted')

        const stored = await Transaction.findById(res.body.data._id)
        expect(stored?.amount).toBe(25050)

        const updatedAccount = await Account.findById(account._id)
        expect(updatedAccount?.currentBalance).toBe(750.5)
    })

    it('creates an expense transaction and subtracts from account balance', async () => {
        const { token } = await registerUser(app)
        const account = await createTestAccount(token, 200)
        const categoryId = await getFoodMasterId(token)

        const res = await createTestTransaction(token, {
            type: 'expense',
            title: 'Groceries',
            amount: 45.25,
            date: '2026-01-16T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        expect(res.status).toBe(201)
        expect(res.body.data.type).toBe('expense')
        expect(res.body.data.amount).toBe(45.25)

        const updatedAccount = await Account.findById(account._id)
        expect(updatedAccount?.currentBalance).toBe(154.75)
    })

    it('lists transactions with pagination and type filter', async () => {
        const { token } = await registerUser(app)
        const account = await createTestAccount(token)
        const incomeCategoryId = await getIncomeMasterId(token)
        const expenseCategoryId = await getFoodMasterId(token)

        await createTestTransaction(token, {
            type: 'income',
            title: 'Income One',
            amount: 100,
            date: '2026-01-01T12:00:00.000Z',
            accountId: account._id,
            categoryId: incomeCategoryId,
        })

        await createTestTransaction(token, {
            type: 'expense',
            title: 'Expense One',
            amount: 20,
            date: '2026-01-02T12:00:00.000Z',
            accountId: account._id,
            categoryId: expenseCategoryId,
        })

        const allRes = await request(app)
            .get('/api/v1/transactions')
            .set(authHeader(token))

        expect(allRes.status).toBe(200)
        expect(allRes.body.data.data).toHaveLength(2)
        expect(allRes.body.data.meta.totalTransactions).toBe(2)

        const expenseRes = await request(app)
            .get('/api/v1/transactions?type=expense')
            .set(authHeader(token))

        expect(expenseRes.status).toBe(200)
        expect(expenseRes.body.data.data).toHaveLength(1)
        expect(expenseRes.body.data.data[0].type).toBe('expense')
    })

    it('filters transactions by status (X4 draft filter on /transactions)', async () => {
        const { token } = await registerUser(app)
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const postedRes = await createTestTransaction(token, {
            type: 'expense',
            title: 'Posted expense',
            amount: 20,
            date: '2026-01-02T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        await Transaction.create({
            userId: postedRes.body.data.userId,
            accountId: account._id,
            categoryId,
            type: 'expense',
            status: 'draft',
            amount: 1500,
            currency: 'USD',
            title: 'Draft expense',
            date: new Date('2026-01-03T12:00:00.000Z'),
        })

        const allRes = await request(app)
            .get('/api/v1/transactions')
            .set(authHeader(token))
        expect(allRes.body.data.data).toHaveLength(2)

        const draftRes = await request(app)
            .get('/api/v1/transactions?status=draft')
            .set(authHeader(token))
        expect(draftRes.status).toBe(200)
        expect(draftRes.body.data.data).toHaveLength(1)
        expect(draftRes.body.data.data[0].title).toBe('Draft expense')

        const postedListRes = await request(app)
            .get('/api/v1/transactions?status=posted')
            .set(authHeader(token))
        expect(postedListRes.status).toBe(200)
        expect(postedListRes.body.data.data).toHaveLength(1)
        expect(postedListRes.body.data.data[0].title).toBe('Posted expense')

        const invalidRes = await request(app)
            .get('/api/v1/transactions?status=bogus')
            .set(authHeader(token))
        expect(invalidRes.status).toBe(400)
    })

    it('filters transactions by status within a date range via /transactions/filter', async () => {
        const { token } = await registerUser(app)
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const postedRes = await createTestTransaction(token, {
            type: 'expense',
            title: 'Posted in range',
            amount: 20,
            date: '2026-02-02T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        await Transaction.create({
            userId: postedRes.body.data.userId,
            accountId: account._id,
            categoryId,
            type: 'expense',
            status: 'draft',
            amount: 1500,
            currency: 'USD',
            title: 'Draft in range',
            date: new Date('2026-02-03T12:00:00.000Z'),
        })

        const res = await request(app)
            .get('/api/v1/transactions/filter?startDate=2026-02-01&endDate=2026-02-28&status=draft')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data).toHaveLength(1)
        expect(res.body.data[0].title).toBe('Draft in range')
    })

    it('gets, updates, and deletes a transaction with balance adjustments', async () => {
        const { token } = await registerUser(app)
        const account = await createTestAccount(token, 300)
        const categoryId = await getFoodMasterId(token)

        const createRes = await createTestTransaction(token, {
            type: 'expense',
            title: 'Coffee',
            amount: 5,
            date: '2026-01-10T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        const transactionId = createRes.body.data._id

        const getRes = await request(app)
            .get(`/api/v1/transactions/${transactionId}`)
            .set(authHeader(token))

        expect(getRes.status).toBe(200)
        expect(getRes.body.data.title).toBe('Coffee')

        const updateRes = await request(app)
            .put(`/api/v1/transactions/${transactionId}`)
            .set(authHeader(token))
            .send({ amount: 8, title: 'Coffee + tip' })

        expect(updateRes.status).toBe(200)
        expect(updateRes.body.data.amount).toBe(8)
        expect(updateRes.body.data.title).toBe('Coffee + tip')

        let updatedAccount = await Account.findById(account._id)
        expect(updatedAccount?.currentBalance).toBe(292)

        const deleteRes = await request(app)
            .delete(`/api/v1/transactions/${transactionId}`)
            .set(authHeader(token))

        expect(deleteRes.status).toBe(200)

        updatedAccount = await Account.findById(account._id)
        expect(updatedAccount?.currentBalance).toBe(300)

        const missingRes = await request(app)
            .get(`/api/v1/transactions/${transactionId}`)
            .set(authHeader(token))

        expect(missingRes.status).toBe(404)
    })

    it('filters transactions by date range using user timezone', async () => {
        const { token, userId } = await registerUser(app)
        await User.findByIdAndUpdate(userId, { timezone: 'Asia/Kolkata' })

        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        await createTestTransaction(token, {
            type: 'expense',
            title: 'In Range',
            amount: 10,
            date: '2026-01-15T06:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        await createTestTransaction(token, {
            type: 'expense',
            title: 'Out of Range',
            amount: 20,
            date: '2026-02-01T06:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        const res = await request(app)
            .get('/api/v1/transactions/filter')
            .query({ startDate: '2026-01-01', endDate: '2026-01-31' })
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data).toHaveLength(1)
        expect(res.body.data[0].title).toBe('In Range')
    })

    it('searches transactions by keyword and amount', async () => {
        const { token } = await registerUser(app)
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        await createTestTransaction(token, {
            type: 'expense',
            title: 'Coffee shop',
            amount: 12.5,
            date: '2026-01-05T12:00:00.000Z',
            accountId: account._id,
            categoryId,
            description: 'Morning latte',
        })

        const titleRes = await request(app)
            .get('/api/v1/transactions/search')
            .query({ keyword: 'coffee' })
            .set(authHeader(token))

        expect(titleRes.status).toBe(200)
        expect(titleRes.body.data).toHaveLength(1)

        const amountRes = await request(app)
            .get('/api/v1/transactions/search')
            .query({ keyword: '12.5' })
            .set(authHeader(token))

        expect(amountRes.status).toBe(200)
        expect(amountRes.body.data).toHaveLength(1)
    })

    it('sorts transactions by category name', async () => {
        const { token } = await registerUser(app)
        const account = await createTestAccount(token, 1000)
        const foodCategoryId = await getFoodMasterId(token)
        const transportCategoryId = await request(app)
            .get('/api/v1/categories')
            .set(authHeader(token))
            .then((res) =>
                res.body.data.masters.find((m: { name: string }) => m.name === 'Transport')._id
            )

        await createTestTransaction(token, {
            type: 'expense',
            title: 'Bus',
            amount: 5,
            date: '2026-01-01T12:00:00.000Z',
            accountId: account._id,
            categoryId: transportCategoryId,
        })

        await createTestTransaction(token, {
            type: 'expense',
            title: 'Groceries',
            amount: 20,
            date: '2026-01-02T12:00:00.000Z',
            accountId: account._id,
            categoryId: foodCategoryId,
        })

        const sortRes = await request(app)
            .get('/api/v1/transactions?sortBy=category&sortOrder=asc')
            .set(authHeader(token))

        expect(sortRes.status).toBe(200)
        expect(sortRes.body.data.data).toHaveLength(2)
        expect(sortRes.body.data.data[0].title).toBe('Groceries')
        expect(sortRes.body.data.data[1].title).toBe('Bus')
    })

    it('sorts transactions by amount and supports duplicate', async () => {
        const { token } = await registerUser(app)
        const account = await createTestAccount(token, 1000)
        const categoryId = await getFoodMasterId(token)

        const first = await createTestTransaction(token, {
            type: 'expense',
            title: 'Small',
            amount: 5,
            date: '2026-01-01T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        await createTestTransaction(token, {
            type: 'expense',
            title: 'Large',
            amount: 50,
            date: '2026-01-02T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        const sortRes = await request(app)
            .get('/api/v1/transactions?sortBy=amount&sortOrder=asc')
            .set(authHeader(token))

        expect(sortRes.status).toBe(200)
        expect(sortRes.body.data.data[0].amount).toBe(5)
        expect(sortRes.body.data.data[1].amount).toBe(50)

        const duplicateRes = await request(app)
            .post(`/api/v1/transactions/duplicate/${first.body.data._id}`)
            .set(authHeader(token))

        expect(duplicateRes.status).toBe(201)
        expect(duplicateRes.body.data.title).toBe('Small')
        expect(duplicateRes.body.data._id).not.toBe(first.body.data._id)

        const updatedAccount = await Account.findById(account._id)
        expect(updatedAccount?.currentBalance).toBe(940)
    })

    it('exports transactions as CSV', async () => {
        const { token } = await registerUser(app)
        const account = await createTestAccount(token)
        const categoryId = await getIncomeMasterId(token)

        await createTestTransaction(token, {
            type: 'income',
            title: 'Bonus',
            amount: 100,
            date: '2026-01-20T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        const res = await request(app).get('/api/v1/transactions/download').set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toMatch(/text\/csv/)
        expect(res.text).toContain('Type,Title,Amount')
        expect(res.text).toContain('Bonus')
        expect(res.text).toContain('100.00')
    })

    it('exports transactions as JSON with type and date filters', async () => {
        const { token } = await seedUserDirectly({ email: 'tx-export-json@example.com' })
        const account = await createTestAccount(token)
        const incomeCategoryId = await getIncomeMasterId(token)
        const expenseCategoryId = await getFoodMasterId(token)

        await createTestTransaction(token, {
            type: 'income',
            title: 'Salary',
            amount: 200,
            date: '2026-01-10T12:00:00.000Z',
            accountId: account._id,
            categoryId: incomeCategoryId,
        })

        await createTestTransaction(token, {
            type: 'expense',
            title: 'Groceries',
            amount: 40,
            date: '2026-01-15T12:00:00.000Z',
            accountId: account._id,
            categoryId: expenseCategoryId,
        })

        const res = await request(app)
            .get('/api/v1/transactions/download')
            .query({
                format: 'json',
                type: 'expense',
                startDate: '2026-01-01',
                endDate: '2026-01-31',
            })
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toMatch(/application\/json/)
        const payload = JSON.parse(res.text)
        expect(payload.count).toBe(1)
        expect(payload.transactions[0].title).toBe('Groceries')
        expect(payload.filters.type).toBe('expense')
    })

    it('exports income and expense transactions when type is both', async () => {
        const { token } = await seedUserDirectly({ email: 'tx-export-both@example.com' })
        const account = await createTestAccount(token)
        const incomeCategoryId = await getIncomeMasterId(token)
        const expenseCategoryId = await getFoodMasterId(token)

        await createTestTransaction(token, {
            type: 'income',
            title: 'Salary',
            amount: 200,
            date: '2026-01-10T12:00:00.000Z',
            accountId: account._id,
            categoryId: incomeCategoryId,
        })

        await createTestTransaction(token, {
            type: 'expense',
            title: 'Groceries',
            amount: 40,
            date: '2026-01-15T12:00:00.000Z',
            accountId: account._id,
            categoryId: expenseCategoryId,
        })

        const res = await request(app)
            .get('/api/v1/transactions/download')
            .query({ format: 'json', type: 'both' })
            .set(authHeader(token))

        expect(res.status).toBe(200)
        const payload = JSON.parse(res.text)
        expect(payload.count).toBe(2)
        expect(payload.transactions.map((item: { type: string }) => item.type).sort()).toEqual([
            'expense',
            'income',
        ])
    })

    it('exports transactions as PDF', async () => {
        const { token } = await seedUserDirectly({ email: 'tx-export-pdf@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getIncomeMasterId(token)

        await createTestTransaction(token, {
            type: 'income',
            title: 'Bonus',
            amount: 100,
            date: '2026-01-20T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        const res = await request(app)
            .get('/api/v1/transactions/download')
            .query({ format: 'pdf' })
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toMatch(/application\/pdf/)
        expect(res.body.subarray(0, 4).toString()).toBe('%PDF')
    })

    it('returns 403 when accessing another user transaction', async () => {
        const owner = await seedUserDirectly({ email: 'tx-owner@example.com' })
        const other = await seedUserDirectly({ email: 'tx-other@example.com' })
        const account = await createTestAccount(owner.token)
        const categoryId = await getFoodMasterId(owner.token)

        const createRes = await createTestTransaction(owner.token, {
            type: 'expense',
            title: 'Private',
            amount: 10,
            date: '2026-01-01T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        const res = await request(app)
            .get(`/api/v1/transactions/${createRes.body.data._id}`)
            .set(authHeader(other.token))

        expect(res.status).toBe(403)
    })

    it('does not shadow static routes with :transactionId param', async () => {
        const { token } = await seedUserDirectly({ email: 'route-shadow@example.com' })

        const filterRes = await request(app)
            .get('/api/v1/transactions/filter')
            .query({ startDate: '2026-01-01', endDate: '2026-01-31' })
            .set(authHeader(token))

        expect(filterRes.status).toBe(200)
        expect(Array.isArray(filterRes.body.data)).toBe(true)

        const searchRes = await request(app)
            .get('/api/v1/transactions/search')
            .query({ keyword: 'coffee' })
            .set(authHeader(token))

        expect(searchRes.status).toBe(200)
        expect(Array.isArray(searchRes.body.data)).toBe(true)
    })

    it('creates a transfer between two accounts atomically', async () => {
        const { token } = await seedUserDirectly({ email: 'transfer-create@example.com' })
        const fromAccount = await createTestAccount(token, 500)
        const toAccountRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({
                name: 'Savings',
                type: 'savings',
                openingBalance: 100,
            })
        const toAccount = toAccountRes.body.data

        const res = await request(app)
            .post('/api/v1/transactions/transfer')
            .set(authHeader(token))
            .send({
                title: 'Move to savings',
                amount: 150,
                date: '2026-01-01T12:00:00.000Z',
                fromAccountId: fromAccount._id,
                toAccountId: toAccount._id,
            })

        expect(res.status).toBe(201)
        expect(res.body.data.outbound.type).toBe('transfer')
        expect(res.body.data.inbound.type).toBe('transfer')
        expect(res.body.data.outbound.transferPairId).toBe(res.body.data.inbound._id)
        expect(res.body.data.inbound.transferPairId).toBe(res.body.data.outbound._id)

        const updatedFrom = await Account.findById(fromAccount._id)
        const updatedTo = await Account.findById(toAccount._id)
        expect(updatedFrom?.currentBalance).toBe(350)
        expect(updatedTo?.currentBalance).toBe(250)

        const listed = await Transaction.find({ userId: res.body.data.outbound.userId })
        expect(listed).toHaveLength(2)
    })

    it('rejects transfer when source and destination are the same account', async () => {
        const { token } = await seedUserDirectly({ email: 'transfer-same@example.com' })
        const account = await createTestAccount(token)

        const res = await request(app)
            .post('/api/v1/transactions/transfer')
            .set(authHeader(token))
            .send({
                title: 'Invalid transfer',
                amount: 10,
                date: '2026-01-01T12:00:00.000Z',
                fromAccountId: account._id,
                toAccountId: account._id,
            })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/different/i)
    })

    it('deletes a transfer pair and restores both account balances', async () => {
        const { token } = await seedUserDirectly({ email: 'transfer-delete@example.com' })
        const fromAccount = await createTestAccount(token, 400)
        const toAccountRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({
                name: 'Cash',
                type: 'cash',
                openingBalance: 50,
            })
        const toAccount = toAccountRes.body.data

        const createRes = await request(app)
            .post('/api/v1/transactions/transfer')
            .set(authHeader(token))
            .send({
                title: 'Temporary move',
                amount: 75,
                date: '2026-01-01T12:00:00.000Z',
                fromAccountId: fromAccount._id,
                toAccountId: toAccount._id,
            })

        const outboundId = createRes.body.data.outbound._id

        const deleteRes = await request(app)
            .delete(`/api/v1/transactions/${outboundId}`)
            .set(authHeader(token))

        expect(deleteRes.status).toBe(200)

        const remaining = await Transaction.countDocuments({ userId: createRes.body.data.outbound.userId })
        expect(remaining).toBe(0)

        const updatedFrom = await Account.findById(fromAccount._id)
        const updatedTo = await Account.findById(toAccount._id)
        expect(updatedFrom?.currentBalance).toBe(400)
        expect(updatedTo?.currentBalance).toBe(50)
    })

    it('creates a split expense with validated child lines', async () => {
        const { token } = await seedUserDirectly({ email: 'split-create@example.com' })
        const account = await createTestAccount(token, 200)
        const foodCategoryId = await getFoodMasterId(token)
        const transportCategoryId = await request(app)
            .get('/api/v1/categories')
            .set(authHeader(token))
            .then((res) =>
                res.body.data.masters.find((m: { name: string }) => m.name === 'Transport')._id
            )

        const res = await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(token))
            .send({
                type: 'expense',
                title: 'Mixed shopping trip',
                amount: 100,
                date: '2026-01-05T12:00:00.000Z',
                accountId: account._id,
                splits: [
                    { categoryId: foodCategoryId, amount: 60 },
                    { categoryId: transportCategoryId, amount: 40 },
                ],
            })

        expect(res.status).toBe(201)
        expect(res.body.data.amount).toBe(100)
        expect(res.body.data.splits).toHaveLength(2)
        expect(res.body.data.splits[0].amount).toBe(60)
        expect(res.body.data.splits[1].amount).toBe(40)

        const childCount = await Transaction.countDocuments({
            splitTransactionId: res.body.data._id,
        })
        expect(childCount).toBe(2)

        const listRes = await request(app)
            .get('/api/v1/transactions')
            .set(authHeader(token))

        expect(listRes.body.data.data).toHaveLength(1)

        const updatedAccount = await Account.findById(account._id)
        expect(updatedAccount?.currentBalance).toBe(100)
    })

    it('rejects split expenses when amounts do not sum to the parent total', async () => {
        const { token } = await seedUserDirectly({ email: 'split-reject@example.com' })
        const account = await createTestAccount(token)
        const foodCategoryId = await getFoodMasterId(token)
        const transportCategoryId = await request(app)
            .get('/api/v1/categories')
            .set(authHeader(token))
            .then((res) =>
                res.body.data.masters.find((m: { name: string }) => m.name === 'Transport')._id
            )

        const res = await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(token))
            .send({
                type: 'expense',
                title: 'Bad split',
                amount: 100,
                date: '2026-01-05T12:00:00.000Z',
                accountId: account._id,
                splits: [
                    { categoryId: foodCategoryId, amount: 60 },
                    { categoryId: transportCategoryId, amount: 30 },
                ],
            })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/split amounts/i)
    })

    it('rejects direct transfer type on the standard create endpoint', async () => {
        const { token } = await seedUserDirectly({ email: 'transfer-reject@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const transferAttempt = await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(token))
            .send({
                type: 'transfer',
                title: 'Transfer',
                amount: 10,
                date: '2026-01-01T12:00:00.000Z',
                accountId: account._id,
                categoryId,
            })

        expect(transferAttempt.status).toBe(400)
        expect(transferAttempt.body.message).toMatch(/income or expense/i)
    })
})

describe('moneyUtils', () => {
    it('converts between major and minor units', async () => {
        const { toMinorUnits, fromMinorUnits } = await import('@core/money/moneyUtils')

        expect(toMinorUnits(10.5)).toBe(1050)
        expect(fromMinorUnits(1050)).toBe(10.5)
        expect(toMinorUnits(0)).toBe(0)
    })
})

describe('timezoneUtils', () => {
    it('builds timezone-aware day boundaries', async () => {
        const { resolveDateRange } = await import('@core/time/timezoneUtils')

        const utcRange = resolveDateRange('2026-01-15', '2026-01-15', 'UTC')
        expect(utcRange.start.toISOString()).toBe('2026-01-15T00:00:00.000Z')
        expect(utcRange.end.toISOString()).toBe('2026-01-15T23:59:59.999Z')
    })
})
