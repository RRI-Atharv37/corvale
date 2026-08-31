import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'
import app from '../app'
import Account from '../models/Account'
import Transaction from '../models/Transaction'
import { authHeader, seedUserDirectly } from './helpers'

async function createTestAccount(token: string, openingBalance = 1000, name = 'Checking') {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'checking', openingBalance })
    return res.body.data
}

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const food = res.body.data.masters.find((m: { name: string }) => m.name === 'Food')
    if (!food) throw new Error('Food master category not found')
    return food._id
}

async function getTransportMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const transport = res.body.data.masters.find((m: { name: string }) => m.name === 'Transport')
    if (!transport) throw new Error('Transport master category not found')
    return transport._id
}

async function createExpense(
    token: string,
    accountId: string,
    categoryId: string,
    title: string,
    amount: number
) {
    const res = await request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({
            type: 'expense',
            title,
            amount,
            date: '2026-01-15T12:00:00.000Z',
            accountId,
            categoryId,
        })
    return res.body.data
}

describe('Bulk transaction operations', () => {
    it('bulk deletes multiple transactions and restores account balance', async () => {
        const { token } = await seedUserDirectly({ email: 'bulk-delete@example.com' })
        const account = await createTestAccount(token, 500)
        const categoryId = await getFoodMasterId(token)

        const first = await createExpense(token, account._id, categoryId, 'Coffee', 5)
        const second = await createExpense(token, account._id, categoryId, 'Lunch', 15)

        const res = await request(app)
            .post('/api/v1/transactions/bulk/delete')
            .set(authHeader(token))
            .send({ transactionIds: [first._id, second._id] })

        expect(res.status).toBe(200)
        expect(res.body.data.deletedCount).toBe(2)

        expect(await Transaction.countDocuments({ userId: first.userId })).toBe(0)

        const updatedAccount = await Account.findById(account._id)
        expect(updatedAccount?.currentBalance).toBe(500)
    })

    it('bulk deletes a transfer pair once when both legs are selected', async () => {
        const { token } = await seedUserDirectly({ email: 'bulk-transfer@example.com' })
        const fromAccount = await createTestAccount(token, 400, 'From')
        const toAccount = await createTestAccount(token, 100, 'To')

        const transferRes = await request(app)
            .post('/api/v1/transactions/transfer')
            .set(authHeader(token))
            .send({
                title: 'Move funds',
                amount: 50,
                date: '2026-01-01T12:00:00.000Z',
                fromAccountId: fromAccount._id,
                toAccountId: toAccount._id,
            })

        const outboundId = transferRes.body.data.outbound._id
        const inboundId = transferRes.body.data.inbound._id

        const res = await request(app)
            .post('/api/v1/transactions/bulk/delete')
            .set(authHeader(token))
            .send({ transactionIds: [outboundId, inboundId] })

        expect(res.status).toBe(200)
        expect(res.body.data.deletedCount).toBe(2)

        expect(await Transaction.countDocuments({ userId: transferRes.body.data.outbound.userId })).toBe(
            0
        )

        const updatedFrom = await Account.findById(fromAccount._id)
        const updatedTo = await Account.findById(toAccount._id)
        expect(updatedFrom?.currentBalance).toBe(400)
        expect(updatedTo?.currentBalance).toBe(100)
    })

    it('bulk updates category on selected transactions', async () => {
        const { token } = await seedUserDirectly({ email: 'bulk-category@example.com' })
        const account = await createTestAccount(token)
        const foodCategoryId = await getFoodMasterId(token)
        const transportCategoryId = await getTransportMasterId(token)

        const first = await createExpense(token, account._id, foodCategoryId, 'Bus fare', 3)
        const second = await createExpense(token, account._id, foodCategoryId, 'Taxi', 12)

        const res = await request(app)
            .patch('/api/v1/transactions/bulk/category')
            .set(authHeader(token))
            .send({
                transactionIds: [first._id, second._id],
                categoryId: transportCategoryId,
            })

        expect(res.status).toBe(200)
        expect(res.body.data.updatedCount).toBe(2)

        const updatedFirst = await Transaction.findById(first._id)
        const updatedSecond = await Transaction.findById(second._id)
        expect(updatedFirst?.categoryId.toString()).toBe(transportCategoryId)
        expect(updatedSecond?.categoryId.toString()).toBe(transportCategoryId)
    })

    it('rejects bulk category change when a transfer is included', async () => {
        const { token } = await seedUserDirectly({ email: 'bulk-category-transfer@example.com' })
        const fromAccount = await createTestAccount(token, 300, 'From')
        const toAccount = await createTestAccount(token, 50, 'To')
        const foodCategoryId = await getFoodMasterId(token)
        const transportCategoryId = await getTransportMasterId(token)

        const expense = await createExpense(token, fromAccount._id, foodCategoryId, 'Snack', 4)

        const transferRes = await request(app)
            .post('/api/v1/transactions/transfer')
            .set(authHeader(token))
            .send({
                title: 'Move',
                amount: 10,
                date: '2026-01-01T12:00:00.000Z',
                fromAccountId: fromAccount._id,
                toAccountId: toAccount._id,
            })

        const res = await request(app)
            .patch('/api/v1/transactions/bulk/category')
            .set(authHeader(token))
            .send({
                transactionIds: [expense._id, transferRes.body.data.outbound._id],
                categoryId: transportCategoryId,
            })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/transfer/i)
    })

    it('rejects bulk operations with empty transactionIds', async () => {
        const { token } = await seedUserDirectly({ email: 'bulk-empty@example.com' })

        const deleteRes = await request(app)
            .post('/api/v1/transactions/bulk/delete')
            .set(authHeader(token))
            .send({ transactionIds: [] })

        expect(deleteRes.status).toBe(400)

        const categoryRes = await request(app)
            .patch('/api/v1/transactions/bulk/category')
            .set(authHeader(token))
            .send({ transactionIds: [], categoryId: '507f1f77bcf86cd799439011' })

        expect(categoryRes.status).toBe(400)
    })

    it('SEC-61: rejects a transactionIds array over the 500-id ceiling with 413', async () => {
        const { token } = await seedUserDirectly({ email: 'bulk-cap@example.com' })
        const tooMany = Array.from({ length: 501 }, () => new Types.ObjectId().toString())

        const deleteRes = await request(app)
            .post('/api/v1/transactions/bulk/delete')
            .set(authHeader(token))
            .send({ transactionIds: tooMany })
        expect(deleteRes.status).toBe(413)

        const categoryRes = await request(app)
            .patch('/api/v1/transactions/bulk/category')
            .set(authHeader(token))
            .send({ transactionIds: tooMany, categoryId: new Types.ObjectId().toString() })
        expect(categoryRes.status).toBe(413)
    })

    it('SEC-61: a batch at the 500-id ceiling is still accepted (bogus ids → 404, not 413)', async () => {
        const { token } = await seedUserDirectly({ email: 'bulk-cap-ok@example.com' })
        const exactly500 = Array.from({ length: 500 }, () => new Types.ObjectId().toString())

        const res = await request(app)
            .post('/api/v1/transactions/bulk/delete')
            .set(authHeader(token))
            .send({ transactionIds: exactly500 })
        // Past the size gate: every id is a well-formed ObjectId that does not resolve to one of
        // the caller's transactions, so this collapses to the not-found path, never 413.
        expect(res.status).toBe(404)
    })
})
