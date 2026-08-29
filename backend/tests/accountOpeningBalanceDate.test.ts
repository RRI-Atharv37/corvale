import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import Account from '../models/Account'
import { authHeader, seedUserDirectly } from './helpers'

/**
 * Option 1 ("balance as of a date"): an account's openingBalance is stated as of
 * openingBalanceDate. Transactions dated before that instant are informational
 * only — they must never move currentBalance, whether applied incrementally on
 * write or via a from-scratch recompute. Absent openingBalanceDate keeps the
 * legacy behavior (every transaction counts).
 */

async function masterCategoryId(token: string, name: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const match = res.body.data.masters.find((m: { name: string }) => m.name === name)
    if (!match) {
        throw new Error(`${name} master category not found`)
    }
    return match._id
}

const createAccount = (token: string, body: Record<string, unknown>) =>
    request(app).post('/api/v1/accounts').set(authHeader(token)).send(body)

const createTransaction = (token: string, body: Record<string, unknown>) =>
    request(app).post('/api/v1/transactions').set(authHeader(token)).send(body)

describe('Account openingBalanceDate', () => {
    it('stores openingBalanceDate on create and echoes it back', async () => {
        const { token } = await seedUserDirectly({ email: 'obd-create@example.com' })

        const res = await createAccount(token, {
            name: 'Checking',
            type: 'checking',
            openingBalance: 1000,
            openingBalanceDate: '2026-08-01T00:00:00.000Z',
        })

        expect(res.status).toBe(201)
        expect(res.body.data.currentBalance).toBe(1000)
        expect(new Date(res.body.data.openingBalanceDate).toISOString()).toBe(
            '2026-08-01T00:00:00.000Z'
        )
    })

    it('rejects an invalid openingBalanceDate on create', async () => {
        const { token } = await seedUserDirectly({ email: 'obd-create-bad@example.com' })

        const res = await createAccount(token, {
            name: 'Checking',
            type: 'checking',
            openingBalance: 10,
            openingBalanceDate: 'not-a-date',
        })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/opening balance date/i)
    })

    it('defaults openingBalanceDate to null (legacy: every transaction counts)', async () => {
        const { token } = await seedUserDirectly({ email: 'obd-default-null@example.com' })
        const account = (
            await createAccount(token, { name: 'Checking', type: 'checking', openingBalance: 500 })
        ).body.data
        const foodId = await masterCategoryId(token, 'Food')

        await createTransaction(token, {
            type: 'expense',
            title: 'Old expense',
            amount: 100,
            date: '2000-01-01T12:00:00.000Z',
            accountId: account._id,
            categoryId: foodId,
        })

        const after = await Account.findById(account._id)
        expect(after?.openingBalanceDate ?? null).toBeNull()
        expect(after?.currentBalance).toBe(400)
    })

    it('does not move currentBalance when a transaction is dated before openingBalanceDate', async () => {
        const { token } = await seedUserDirectly({ email: 'obd-backdated@example.com' })
        const account = (
            await createAccount(token, {
                name: 'Checking',
                type: 'checking',
                openingBalance: 1000,
                openingBalanceDate: '2026-08-01T00:00:00.000Z',
            })
        ).body.data
        const foodId = await masterCategoryId(token, 'Food')
        const incomeId = await masterCategoryId(token, 'Income')

        // before the cutoff -> ignored for balance
        await createTransaction(token, {
            type: 'expense',
            title: 'Historical rent',
            amount: 5000,
            date: '2026-07-15T12:00:00.000Z',
            accountId: account._id,
            categoryId: foodId,
        })
        // on/after the cutoff -> applied
        await createTransaction(token, {
            type: 'income',
            title: 'Paycheck',
            amount: 250,
            date: '2026-08-10T12:00:00.000Z',
            accountId: account._id,
            categoryId: incomeId,
        })

        const after = await Account.findById(account._id)
        expect(after?.currentBalance).toBe(1250)

        // a from-scratch recompute agrees
        const recompute = await request(app)
            .post(`/api/v1/accounts/${account._id}/recompute-balance`)
            .set(authHeader(token))
        expect(recompute.body.data.recomputedBalance).toBe(1250)
    })

    it('does not move currentBalance when a pre-cutoff transaction is deleted', async () => {
        const { token } = await seedUserDirectly({ email: 'obd-delete@example.com' })
        const account = (
            await createAccount(token, {
                name: 'Checking',
                type: 'checking',
                openingBalance: 800,
                openingBalanceDate: '2026-08-01T00:00:00.000Z',
            })
        ).body.data
        const foodId = await masterCategoryId(token, 'Food')

        const txn = (
            await createTransaction(token, {
                type: 'expense',
                title: 'Historical',
                amount: 123.45,
                date: '2026-06-01T12:00:00.000Z',
                accountId: account._id,
                categoryId: foodId,
            })
        ).body.data

        expect((await Account.findById(account._id))?.currentBalance).toBe(800)

        await request(app).delete(`/api/v1/transactions/${txn._id}`).set(authHeader(token))

        expect((await Account.findById(account._id))?.currentBalance).toBe(800)
    })

    it('adjusts currentBalance when a transaction date is edited across the cutoff', async () => {
        const { token } = await seedUserDirectly({ email: 'obd-edit-date@example.com' })
        const account = (
            await createAccount(token, {
                name: 'Checking',
                type: 'checking',
                openingBalance: 1000,
                openingBalanceDate: '2026-08-01T00:00:00.000Z',
            })
        ).body.data
        const foodId = await masterCategoryId(token, 'Food')

        const txn = (
            await createTransaction(token, {
                type: 'expense',
                title: 'Groceries',
                amount: 60,
                date: '2026-08-05T12:00:00.000Z',
                accountId: account._id,
                categoryId: foodId,
            })
        ).body.data
        expect((await Account.findById(account._id))?.currentBalance).toBe(940)

        // move it before the cutoff -> delta drops out
        await request(app)
            .put(`/api/v1/transactions/${txn._id}`)
            .set(authHeader(token))
            .send({ date: '2026-07-05T12:00:00.000Z' })
        expect((await Account.findById(account._id))?.currentBalance).toBe(1000)

        // move it back after the cutoff -> delta comes back
        await request(app)
            .put(`/api/v1/transactions/${txn._id}`)
            .set(authHeader(token))
            .send({ date: '2026-08-06T12:00:00.000Z' })
        expect((await Account.findById(account._id))?.currentBalance).toBe(940)
    })

    it('updateAccount recomputes currentBalance when openingBalance changes', async () => {
        const { token } = await seedUserDirectly({ email: 'obd-update-ob@example.com' })
        const account = (
            await createAccount(token, { name: 'Checking', type: 'checking', openingBalance: 100 })
        ).body.data
        const foodId = await masterCategoryId(token, 'Food')

        await createTransaction(token, {
            type: 'expense',
            title: 'Coffee',
            amount: 10,
            date: '2026-08-10T12:00:00.000Z',
            accountId: account._id,
            categoryId: foodId,
        })
        expect((await Account.findById(account._id))?.currentBalance).toBe(90)

        const res = await request(app)
            .put(`/api/v1/accounts/${account._id}`)
            .set(authHeader(token))
            .send({ openingBalance: 500 })

        expect(res.status).toBe(200)
        expect(res.body.data.openingBalance).toBe(500)
        expect(res.body.data.currentBalance).toBe(490)
    })

    it('updateAccount recomputes when openingBalanceDate is set later (imported history)', async () => {
        const { token } = await seedUserDirectly({ email: 'obd-update-obd@example.com' })
        // account created the legacy way - no cutoff
        const account = (
            await createAccount(token, { name: 'Checking', type: 'checking', openingBalance: 2000 })
        ).body.data
        const foodId = await masterCategoryId(token, 'Food')
        const incomeId = await masterCategoryId(token, 'Income')

        await createTransaction(token, {
            type: 'income',
            title: 'Old salary',
            amount: 900,
            date: '2024-01-01T12:00:00.000Z',
            accountId: account._id,
            categoryId: incomeId,
        })
        await createTransaction(token, {
            type: 'expense',
            title: 'Recent',
            amount: 40,
            date: '2026-08-20T12:00:00.000Z',
            accountId: account._id,
            categoryId: foodId,
        })
        // legacy: both counted
        expect((await Account.findById(account._id))?.currentBalance).toBe(2860)

        const res = await request(app)
            .put(`/api/v1/accounts/${account._id}`)
            .set(authHeader(token))
            .send({ openingBalance: 2000, openingBalanceDate: '2026-01-01T00:00:00.000Z' })

        expect(res.status).toBe(200)
        // only the post-cutoff expense now applies: 2000 - 40
        expect(res.body.data.currentBalance).toBe(1960)
    })

    it('still rejects a client-supplied currentBalance on update', async () => {
        const { token } = await seedUserDirectly({ email: 'obd-reject-cb@example.com' })
        const account = (
            await createAccount(token, { name: 'Checking', type: 'checking', openingBalance: 100 })
        ).body.data

        const res = await request(app)
            .put(`/api/v1/accounts/${account._id}`)
            .set(authHeader(token))
            .send({ currentBalance: 99999 })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/currentBalance is server-derived/i)
    })
})
