import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'
import app from '../app'
import Account from '../models/Account'
import Transaction from '../models/Transaction'
// shared/src/balances.ts does not exist yet (Sprint 13.1 deliverable); this
// pure function has no existing equivalent anywhere in the codebase today.
import { recomputeAccountBalance } from '../../shared/src/balances'
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

describe('recomputeAccountBalance (shared pure function)', () => {
    it('sums opening balance plus income and expense deltas for a checking account', () => {
        const account = { openingBalance: 500, type: 'checking' as const }
        const transactions = [
            { type: 'income' as const, amount: 25050, accountId: 'acc1' },
            { type: 'expense' as const, amount: 4525, accountId: 'acc1' },
        ]

        expect(recomputeAccountBalance(account, transactions)).toBeCloseTo(705.25, 2)
    })

    it('inverts the sign for a credit account: expenses increase balance, income decreases it', () => {
        const account = { openingBalance: 0, type: 'credit' as const }
        const transactions = [
            { type: 'expense' as const, amount: 10000, accountId: 'acc1' },
            { type: 'income' as const, amount: 4000, accountId: 'acc1' },
        ]

        expect(recomputeAccountBalance(account, transactions)).toBeCloseTo(60, 2)
    })

    it('returns just the opening balance when there are no transactions', () => {
        const account = { openingBalance: 250.75, type: 'savings' as const }

        expect(recomputeAccountBalance(account, [])).toBeCloseTo(250.75, 2)
    })

    // Transfer-leg direction (outbound vs inbound) can't be derived from the
    // documented element type alone: both legs persist with type: 'transfer'
    // (see transactionController.ts's createTransfer) and only creation-time
    // context — which leg was written first — distinguishes them, which this
    // function's signature doesn't carry. Transfer-pair correctness is
    // exercised end-to-end via the recompute-balance endpoint below instead.

    describe('openingBalanceDate cutoff', () => {
        it('counts every transaction when openingBalanceDate is absent (legacy behavior)', () => {
            const account = { openingBalance: 1000, type: 'checking' as const }
            const transactions = [
                { type: 'expense' as const, amount: 10000, date: '2020-01-01T00:00:00.000Z' },
                { type: 'income' as const, amount: 5000, date: '2026-01-01T00:00:00.000Z' },
            ]

            expect(recomputeAccountBalance(account, transactions)).toBeCloseTo(950, 2)
        })

        it('excludes transactions dated before openingBalanceDate', () => {
            const account = {
                openingBalance: 1000,
                type: 'checking' as const,
                openingBalanceDate: '2026-01-01T00:00:00.000Z',
            }
            const transactions = [
                // pre-cutoff: ignored, already baked into the opening balance
                { type: 'expense' as const, amount: 25000, date: '2025-12-31T23:59:59.000Z' },
                { type: 'income' as const, amount: 999999, date: '2024-06-01T00:00:00.000Z' },
                // on/after cutoff: applied
                { type: 'expense' as const, amount: 4000, date: '2026-01-05T12:00:00.000Z' },
            ]

            expect(recomputeAccountBalance(account, transactions)).toBeCloseTo(960, 2)
        })

        it('includes a transaction dated exactly on openingBalanceDate (inclusive cutoff)', () => {
            const account = {
                openingBalance: 500,
                type: 'checking' as const,
                openingBalanceDate: '2026-02-01T00:00:00.000Z',
            }
            const transactions = [
                { type: 'income' as const, amount: 10000, date: '2026-02-01T00:00:00.000Z' },
            ]

            expect(recomputeAccountBalance(account, transactions)).toBeCloseTo(600, 2)
        })

        it('accepts a Date instance for openingBalanceDate and tx.date', () => {
            const account = {
                openingBalance: 0,
                type: 'checking' as const,
                openingBalanceDate: new Date('2026-01-01T00:00:00.000Z'),
            }
            const transactions = [
                { type: 'income' as const, amount: 5000, date: new Date('2025-01-01T00:00:00.000Z') },
                { type: 'income' as const, amount: 3000, date: new Date('2026-06-01T00:00:00.000Z') },
            ]

            expect(recomputeAccountBalance(account, transactions)).toBeCloseTo(30, 2)
        })

        it('keeps a dated-cutoff transaction that has no date rather than dropping it', () => {
            const account = {
                openingBalance: 100,
                type: 'checking' as const,
                openingBalanceDate: '2026-01-01T00:00:00.000Z',
            }
            const transactions = [{ type: 'expense' as const, amount: 2500 }]

            expect(recomputeAccountBalance(account, transactions)).toBeCloseTo(75, 2)
        })

        it('ignores an unparseable openingBalanceDate (falls back to counting everything)', () => {
            const account = {
                openingBalance: 100,
                type: 'checking' as const,
                openingBalanceDate: 'not-a-date',
            }
            const transactions = [
                { type: 'expense' as const, amount: 2500, date: '2000-01-01T00:00:00.000Z' },
            ]

            expect(recomputeAccountBalance(account, transactions)).toBeCloseTo(75, 2)
        })

        it('applies the cutoff before the credit-account sign flip', () => {
            const account = {
                openingBalance: 0,
                type: 'credit' as const,
                openingBalanceDate: '2026-01-01T00:00:00.000Z',
            }
            const transactions = [
                { type: 'expense' as const, amount: 50000, date: '2025-01-01T00:00:00.000Z' },
                { type: 'expense' as const, amount: 10000, date: '2026-03-01T00:00:00.000Z' },
            ]

            expect(recomputeAccountBalance(account, transactions)).toBeCloseTo(100, 2)
        })
    })
})

describe('POST /accounts/:accountId/recompute-balance', () => {
    it('recomputes an account balance matching the incrementally-maintained balance', async () => {
        const { token } = await seedUserDirectly({ email: 'recompute-basic@example.com' })
        const account = await createTestAccount(token, 500)
        const incomeCategoryId = await getIncomeMasterId(token)
        const foodCategoryId = await getFoodMasterId(token)

        await createTestTransaction(token, {
            type: 'income',
            title: 'Paycheck',
            amount: 250.5,
            date: '2026-01-15T12:00:00.000Z',
            accountId: account._id,
            categoryId: incomeCategoryId,
        })
        await createTestTransaction(token, {
            type: 'expense',
            title: 'Groceries',
            amount: 45.25,
            date: '2026-01-16T12:00:00.000Z',
            accountId: account._id,
            categoryId: foodCategoryId,
        })

        const before = await Account.findById(account._id)
        expect(before?.currentBalance).toBeCloseTo(705.25, 2)

        const res = await request(app)
            .post(`/api/v1/accounts/${account._id}/recompute-balance`)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data.accountId).toBe(account._id)
        expect(res.body.data.previousBalance).toBeCloseTo(705.25, 2)
        expect(res.body.data.recomputedBalance).toBeCloseTo(705.25, 2)

        const after = await Account.findById(account._id)
        expect(after?.currentBalance).toBeCloseTo(705.25, 2)
    })

    it('recomputes both legs of a transfer pair to match incrementally-maintained balances', async () => {
        const { token } = await seedUserDirectly({ email: 'recompute-transfer@example.com' })
        const fromAccount = await createTestAccount(token, 400)
        const toAccountRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Savings', type: 'savings', openingBalance: 100 })
        const toAccount = toAccountRes.body.data

        await request(app)
            .post('/api/v1/transactions/transfer')
            .set(authHeader(token))
            .send({
                title: 'Move to savings',
                amount: 75,
                date: '2026-01-01T12:00:00.000Z',
                fromAccountId: fromAccount._id,
                toAccountId: toAccount._id,
            })

        const fromBefore = await Account.findById(fromAccount._id)
        const toBefore = await Account.findById(toAccount._id)

        const fromRes = await request(app)
            .post(`/api/v1/accounts/${fromAccount._id}/recompute-balance`)
            .set(authHeader(token))
        const toRes = await request(app)
            .post(`/api/v1/accounts/${toAccount._id}/recompute-balance`)
            .set(authHeader(token))

        expect(fromRes.status).toBe(200)
        expect(fromRes.body.data.recomputedBalance).toBeCloseTo(fromBefore?.currentBalance ?? NaN, 2)

        expect(toRes.status).toBe(200)
        expect(toRes.body.data.recomputedBalance).toBeCloseTo(toBefore?.currentBalance ?? NaN, 2)
    })

    it('counts a split parent once and ignores split children to match the incremental balance', async () => {
        const { token } = await seedUserDirectly({ email: 'recompute-split@example.com' })
        const account = await createTestAccount(token, 200)
        const foodCategoryId = await getFoodMasterId(token)
        const transportCategoryId = await getTransportMasterId(token)

        await request(app)
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

        const before = await Account.findById(account._id)
        expect(before?.currentBalance).toBe(100)

        const res = await request(app)
            .post(`/api/v1/accounts/${account._id}/recompute-balance`)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.recomputedBalance).toBe(100)
    })

    it('applies the credit account sign convention when recomputing', async () => {
        const { token } = await seedUserDirectly({ email: 'recompute-credit@example.com' })
        const creditRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Credit Card', type: 'credit', openingBalance: 0 })
        const creditAccount = creditRes.body.data
        const foodCategoryId = await getFoodMasterId(token)
        const incomeCategoryId = await getIncomeMasterId(token)

        await createTestTransaction(token, {
            type: 'expense',
            title: 'Charge',
            amount: 100,
            date: '2026-01-01T12:00:00.000Z',
            accountId: creditAccount._id,
            categoryId: foodCategoryId,
        })
        await createTestTransaction(token, {
            type: 'income',
            title: 'Payment',
            amount: 40,
            date: '2026-01-02T12:00:00.000Z',
            accountId: creditAccount._id,
            categoryId: incomeCategoryId,
        })

        const before = await Account.findById(creditAccount._id)
        expect(before?.currentBalance).toBeCloseTo(60, 2)

        const res = await request(app)
            .post(`/api/v1/accounts/${creditAccount._id}/recompute-balance`)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.recomputedBalance).toBeCloseTo(60, 2)
    })

    it('excludes a soft-deleted transaction that currentBalance had not yet been reversed for', async () => {
        const { token } = await seedUserDirectly({ email: 'recompute-softdelete@example.com' })
        const account = await createTestAccount(token, 100)
        const categoryId = await getFoodMasterId(token)

        const createRes = await createTestTransaction(token, {
            type: 'expense',
            title: 'Ghost expense',
            amount: 30,
            date: '2026-01-01T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        const beforeSoftDelete = await Account.findById(account._id)
        expect(beforeSoftDelete?.currentBalance).toBe(70)

        // Flip deletedAt directly, bypassing the normal DELETE endpoint (and its
        // balance-reversal side effect), so currentBalance still reflects the
        // now-deleted transaction and recompute must independently exclude it
        // by reading straight from the (soft-delete-filtered) transaction store.
        await Transaction.findByIdAndUpdate(createRes.body.data._id, { deletedAt: new Date() })

        const res = await request(app)
            .post(`/api/v1/accounts/${account._id}/recompute-balance`)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.previousBalance).toBe(70)
        expect(res.body.data.recomputedBalance).toBe(100)

        const after = await Account.findById(account._id)
        expect(after?.currentBalance).toBe(100)
    })

    it('is idempotent: calling recompute twice in a row produces no drift', async () => {
        const { token } = await seedUserDirectly({ email: 'recompute-idempotent@example.com' })
        const account = await createTestAccount(token, 500)
        const categoryId = await getFoodMasterId(token)

        await createTestTransaction(token, {
            type: 'expense',
            title: 'Rent',
            amount: 200,
            date: '2026-01-01T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        const first = await request(app)
            .post(`/api/v1/accounts/${account._id}/recompute-balance`)
            .set(authHeader(token))
        const second = await request(app)
            .post(`/api/v1/accounts/${account._id}/recompute-balance`)
            .set(authHeader(token))

        expect(first.status).toBe(200)
        expect(second.status).toBe(200)
        expect(second.body.data.previousBalance).toBe(first.body.data.recomputedBalance)
        expect(second.body.data.recomputedBalance).toBe(first.body.data.recomputedBalance)
    })

    it('returns 403 when a non-owner requests recompute', async () => {
        const owner = await seedUserDirectly({ email: 'recompute-owner@example.com' })
        const other = await createSecondUser(app)
        const account = await createTestAccount(owner.token, 100)

        const res = await request(app)
            .post(`/api/v1/accounts/${account._id}/recompute-balance`)
            .set(authHeader(other.token))

        expect(res.status).toBe(403)
    })

    it('returns 403 when a workspace viewer requests recompute', async () => {
        const owner = await seedUserDirectly({ email: 'recompute-ws-owner@example.com' })
        const viewer = await seedUserDirectly({
            fullName: 'Recompute Viewer',
            email: 'recompute-ws-viewer@example.com',
            password: 'RecomputeViewer123!',
        })

        const workspaceRes = await request(app)
            .post('/api/v1/workspaces')
            .set(authHeader(owner.token))
            .send({ name: 'Recompute WS' })
        const workspaceId = workspaceRes.body.data._id

        const inviteRes = await request(app)
            .post(`/api/v1/workspaces/${workspaceId}/members`)
            .set(authHeader(owner.token))
            .send({ email: viewer.email, role: 'viewer' })
        await request(app)
            .post(`/api/v1/workspaces/invites/${inviteRes.body.data._id}/accept`)
            .set(authHeader(viewer.token))

        const accountRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(owner.token))
            .send({ name: 'Shared Checking', type: 'checking', openingBalance: 500, workspaceId })
        const account = accountRes.body.data

        const res = await request(app)
            .post(`/api/v1/accounts/${account._id}/recompute-balance`)
            .set(authHeader(viewer.token))

        expect(res.status).toBe(403)
    })

    it('returns 404 for a nonexistent account', async () => {
        const { token } = await seedUserDirectly({ email: 'recompute-404@example.com' })

        const res = await request(app)
            .post(`/api/v1/accounts/${new Types.ObjectId().toString()}/recompute-balance`)
            .set(authHeader(token))

        expect(res.status).toBe(404)
    })
})
