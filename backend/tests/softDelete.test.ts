import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Transaction } from '@modules/transactions'
import { Saver } from '@modules/savers'
import { Notification } from '@modules/notifications'
// softDeletePlugin/SOFT_DELETE_BYPASS mirror plugins/rowLevelSecurityPlugin.ts +
// utils/rowLevelSecurity.ts's RLS_BYPASS query-option pattern, but applied
// unconditionally (not gated on an RLS-style AsyncLocalStorage context) since
// tombstoning must hide rows everywhere.
import { SOFT_DELETE_BYPASS } from '@core/softDelete/softDelete'
import { authHeader, createSecondUser, seedUserDirectly } from './helpers'

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

async function createTestAccount(token: string, openingBalance = 1000) {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name: 'Checking', type: 'checking', openingBalance })

    return res.body.data
}

interface TransactionPayload {
    type: 'income' | 'expense'
    title: string
    amount: number
    date: string
    accountId: string
    categoryId?: string
    splits?: { categoryId: string; amount: number }[]
}

async function createTestTransaction(token: string, payload: TransactionPayload) {
    return request(app).post('/api/v1/transactions').set(authHeader(token)).send(payload)
}

describe('Soft delete - transaction tombstones', () => {
    it('sets deletedAt on delete instead of physically removing the document', async () => {
        const { token } = await seedUserDirectly({ email: 'soft-tx-basic@example.com' })
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

        const deleteRes = await request(app)
            .delete(`/api/v1/transactions/${transactionId}`)
            .set(authHeader(token))
        expect(deleteRes.status).toBe(200)

        const hidden = await Transaction.findById(transactionId)
        expect(hidden).toBeNull()

        const tombstone = await Transaction.findById(transactionId).setOptions({
            [SOFT_DELETE_BYPASS]: true,
        })
        expect(tombstone).not.toBeNull()
        expect(tombstone?.deletedAt).toBeInstanceOf(Date)
    })

    it('excludes a soft-deleted transaction from GET /transactions', async () => {
        const { token } = await seedUserDirectly({ email: 'soft-tx-list@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const keep = await createTestTransaction(token, {
            type: 'expense',
            title: 'Keep',
            amount: 10,
            date: '2026-01-01T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })
        const remove = await createTestTransaction(token, {
            type: 'expense',
            title: 'Remove',
            amount: 20,
            date: '2026-01-02T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        await request(app)
            .delete(`/api/v1/transactions/${remove.body.data._id}`)
            .set(authHeader(token))

        const listRes = await request(app).get('/api/v1/transactions').set(authHeader(token))

        expect(listRes.status).toBe(200)
        expect(listRes.body.data.data).toHaveLength(1)
        expect(listRes.body.data.data[0]._id).toBe(keep.body.data._id)
        expect(listRes.body.data.meta.totalTransactions).toBe(1)
    })

    it('excludes a soft-deleted transaction from GET /transactions/filter', async () => {
        const { token } = await seedUserDirectly({ email: 'soft-tx-filter@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const remove = await createTestTransaction(token, {
            type: 'expense',
            title: 'Remove',
            amount: 20,
            date: '2026-01-15T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })
        await request(app)
            .delete(`/api/v1/transactions/${remove.body.data._id}`)
            .set(authHeader(token))

        const filterRes = await request(app)
            .get('/api/v1/transactions/filter')
            .query({ startDate: '2026-01-01', endDate: '2026-01-31' })
            .set(authHeader(token))

        expect(filterRes.status).toBe(200)
        expect(filterRes.body.data).toHaveLength(0)
    })

    it('excludes a soft-deleted transaction from GET /transactions/search', async () => {
        const { token } = await seedUserDirectly({ email: 'soft-tx-search@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const remove = await createTestTransaction(token, {
            type: 'expense',
            title: 'Coffee shop',
            amount: 12.5,
            date: '2026-01-05T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })
        await request(app)
            .delete(`/api/v1/transactions/${remove.body.data._id}`)
            .set(authHeader(token))

        const searchRes = await request(app)
            .get('/api/v1/transactions/search')
            .query({ keyword: 'coffee' })
            .set(authHeader(token))

        expect(searchRes.status).toBe(200)
        expect(searchRes.body.data).toHaveLength(0)
    })

    it('excludes a soft-deleted transaction from dashboard summary aggregations', async () => {
        const { token } = await seedUserDirectly({ email: 'soft-tx-dashboard@example.com' })
        const account = await createTestAccount(token)
        const incomeCategoryId = await getIncomeMasterId(token)
        const foodCategoryId = await getFoodMasterId(token)

        await createTestTransaction(token, {
            type: 'income',
            title: 'Salary',
            amount: 1000,
            date: '2026-01-05T12:00:00.000Z',
            accountId: account._id,
            categoryId: incomeCategoryId,
        })
        const removedExpense = await createTestTransaction(token, {
            type: 'expense',
            title: 'Removed expense',
            amount: 300,
            date: '2026-01-06T12:00:00.000Z',
            accountId: account._id,
            categoryId: foodCategoryId,
        })
        await request(app)
            .delete(`/api/v1/transactions/${removedExpense.body.data._id}`)
            .set(authHeader(token))

        const summaryRes = await request(app)
            .get('/api/v1/dashboard/summary')
            .query({ startDate: '2026-01-01', endDate: '2026-01-31' })
            .set(authHeader(token))

        expect(summaryRes.status).toBe(200)
        expect(summaryRes.body.data.totalIncome).toBe(1000)
        expect(summaryRes.body.data.totalExpenses).toBe(0)
    })

    it('excludes a soft-deleted transaction from budget spent calculations', async () => {
        const { token } = await seedUserDirectly({ email: 'soft-tx-budget@example.com' })
        const account = await createTestAccount(token)
        const foodCategoryId = await getFoodMasterId(token)

        const budgetRes = await request(app)
            .post('/api/v1/budgets')
            .set(authHeader(token))
            .send({
                periodType: 'monthly',
                year: 2026,
                month: 1,
                amount: 500,
                name: 'Food budget',
                categoryId: foodCategoryId,
            })
        const budgetId = budgetRes.body.data._id

        const removedExpense = await createTestTransaction(token, {
            type: 'expense',
            title: 'Removed groceries',
            amount: 150,
            date: '2026-01-10T12:00:00.000Z',
            accountId: account._id,
            categoryId: foodCategoryId,
        })
        await request(app)
            .delete(`/api/v1/transactions/${removedExpense.body.data._id}`)
            .set(authHeader(token))

        const progressRes = await request(app)
            .get(`/api/v1/budgets/${budgetId}/progress`)
            .set(authHeader(token))

        expect(progressRes.status).toBe(200)
        expect(progressRes.body.data.spent).toBe(0)
    })

    it('soft-deletes both legs of a transfer pair', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'soft-tx-transfer@example.com' })
        const fromAccount = await createTestAccount(token, 400)
        const toAccountRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Savings', type: 'savings', openingBalance: 100 })
        const toAccount = toAccountRes.body.data

        const createRes = await request(app)
            .post('/api/v1/transactions/transfer')
            .set(authHeader(token))
            .send({
                title: 'Move to savings',
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

        const visible = await Transaction.countDocuments({ userId })
        expect(visible).toBe(0)

        const tombstoned = await Transaction.find({ userId }).setOptions({
            [SOFT_DELETE_BYPASS]: true,
        })
        expect(tombstoned).toHaveLength(2)
        expect(tombstoned.every((tx) => tx.deletedAt instanceof Date)).toBe(true)
    })

    it('soft-deletes split children when the split parent is deleted', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'soft-tx-split@example.com' })
        const account = await createTestAccount(token, 200)
        const foodCategoryId = await getFoodMasterId(token)
        const transportCategoryId = await getTransportMasterId(token)

        const createRes = await createTestTransaction(token, {
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
        const parentId = createRes.body.data._id

        const deleteRes = await request(app)
            .delete(`/api/v1/transactions/${parentId}`)
            .set(authHeader(token))
        expect(deleteRes.status).toBe(200)

        const visibleChildren = await Transaction.find({
            userId,
            splitTransactionId: parentId,
        })
        expect(visibleChildren).toHaveLength(0)

        const tombstonedChildren = await Transaction.find({
            userId,
            splitTransactionId: parentId,
        }).setOptions({ [SOFT_DELETE_BYPASS]: true })
        expect(tombstonedChildren).toHaveLength(2)
        expect(tombstonedChildren.every((child) => child.deletedAt instanceof Date)).toBe(true)
    })

    it('returns 404 from GET /:id and PUT /:id after soft delete', async () => {
        const { token } = await seedUserDirectly({ email: 'soft-tx-404@example.com' })
        const account = await createTestAccount(token, 300)
        const categoryId = await getFoodMasterId(token)

        const createRes = await createTestTransaction(token, {
            type: 'expense',
            title: 'Snack',
            amount: 5,
            date: '2026-01-10T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })
        const transactionId = createRes.body.data._id

        await request(app)
            .delete(`/api/v1/transactions/${transactionId}`)
            .set(authHeader(token))

        const getRes = await request(app)
            .get(`/api/v1/transactions/${transactionId}`)
            .set(authHeader(token))
        expect(getRes.status).toBe(404)

        const putRes = await request(app)
            .put(`/api/v1/transactions/${transactionId}`)
            .set(authHeader(token))
            .send({ amount: 8 })
        expect(putRes.status).toBe(404)
    })
})

describe('Soft delete - bypass semantics', () => {
    it('a query using SOFT_DELETE_BYPASS sees soft-deleted transactions', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'soft-bypass@example.com' })
        const account = await createTestAccount(token, 100)
        const categoryId = await getFoodMasterId(token)

        const createRes = await createTestTransaction(token, {
            type: 'expense',
            title: 'Bypass target',
            amount: 15,
            date: '2026-01-01T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })
        await request(app)
            .delete(`/api/v1/transactions/${createRes.body.data._id}`)
            .set(authHeader(token))

        const normal = await Transaction.find({ userId })
        expect(normal).toHaveLength(0)

        const bypassed = await Transaction.find({ userId }).setOptions({
            [SOFT_DELETE_BYPASS]: true,
        })
        expect(bypassed).toHaveLength(1)
        expect(bypassed[0].deletedAt).toBeInstanceOf(Date)
    })
})

describe('Soft delete - partial unique indexes', () => {
    it('allows creating a Tag with the same name after the original is soft-deleted', async () => {
        const { token } = await seedUserDirectly({ email: 'soft-tag-reuse@example.com' })

        const createRes = await request(app)
            .post('/api/v1/tags')
            .set(authHeader(token))
            .send({ name: 'Groceries' })
        expect(createRes.status).toBe(201)

        const deleteRes = await request(app)
            .delete(`/api/v1/tags/${createRes.body.data._id}`)
            .set(authHeader(token))
        expect(deleteRes.status).toBe(200)

        const recreateRes = await request(app)
            .post('/api/v1/tags')
            .set(authHeader(token))
            .send({ name: 'Groceries' })
        expect(recreateRes.status).toBe(201)
        expect(recreateRes.body.data._id).not.toBe(createRes.body.data._id)
    })

    // Saver has no dedicated "create" endpoint (addSaver upserts a per-user singleton),
    // so the partial-unique-index behavior is exercised directly against the model.
    it('allows a new Saver document for the same user after the existing one is soft-deleted', async () => {
        const { userId } = await seedUserDirectly({ email: 'soft-saver-reuse@example.com' })

        const original = await Saver.create({ userId, saverAmount: 100 })
        await Saver.findByIdAndUpdate(original._id, { deletedAt: new Date() })

        const recreated = await Saver.create({ userId, saverAmount: 50 })
        expect(recreated._id).not.toEqual(original._id)

        const activeSavers = await Saver.find({ userId })
        expect(activeSavers).toHaveLength(1)
        expect(activeSavers[0]._id).toEqual(recreated._id)
    })

    // Notification has no direct "create with explicit dedupeKey" HTTP endpoint either,
    // so this is exercised directly against the model, mirroring the Saver case above.
    it('allows a new Notification with the same dedupeKey after the original is soft-deleted', async () => {
        const { userId } = await seedUserDirectly({ email: 'soft-notif-reuse@example.com' })

        const original = await Notification.create({
            userId,
            type: 'bill_due',
            title: 'Bill due',
            message: 'Electric bill due',
            dedupeKey: 'bill_due:electric:2026-01',
        })
        await Notification.findByIdAndUpdate(original._id, { deletedAt: new Date() })

        const recreated = await Notification.create({
            userId,
            type: 'bill_due',
            title: 'Bill due',
            message: 'Electric bill due (again)',
            dedupeKey: 'bill_due:electric:2026-01',
        })
        expect(recreated._id).not.toEqual(original._id)

        const activeNotifications = await Notification.find({ userId, dedupeKey: original.dedupeKey })
        expect(activeNotifications).toHaveLength(1)
        expect(activeNotifications[0]._id).toEqual(recreated._id)
    })
})

describe('Soft delete - ownership scoping', () => {
    it('does not let another user see or resurrect a soft-deleted transaction via the bypass', async () => {
        const owner = await seedUserDirectly({ email: 'soft-owner@example.com' })
        const other = await createSecondUser(app)
        const account = await createTestAccount(owner.token, 100)
        const categoryId = await getFoodMasterId(owner.token)

        const createRes = await createTestTransaction(owner.token, {
            type: 'expense',
            title: 'Owner only',
            amount: 10,
            date: '2026-01-01T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })
        await request(app)
            .delete(`/api/v1/transactions/${createRes.body.data._id}`)
            .set(authHeader(owner.token))

        const res = await request(app)
            .get(`/api/v1/transactions/${createRes.body.data._id}`)
            .set(authHeader(other.token))

        expect(res.status).toBe(404)
    })
})
