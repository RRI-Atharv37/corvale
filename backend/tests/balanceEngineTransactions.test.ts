import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import Income from '../models/Income'
import Expense from '../models/Expense'
import { authHeader, registerUser } from './helpers'

/**
 * G0 acceptance spec (TODO.md T0 -> C1, BUG-01).
 *
 * `computeUserBalances` (backend/utils/balanceUtils.ts) currently sources
 * `totalIncome`/`totalExpenses` exclusively from the deprecated `Income`/
 * `Expense` collections, so both are `0` for every user who only ever used
 * the unified `Transaction` model (i.e. every user created after the
 * Phase 1c migration). The fix must source these totals from posted,
 * non-draft, non-split-child `Transaction` rows instead — mirroring the
 * exclusions `sumPostedTransactionsByType` (dashboardUtils.ts) already
 * applies for the period-scoped dashboard summary — while leaving the
 * legacy collections readable (for the migration script) but out of the
 * balance engine entirely.
 *
 * `GET /api/v1/saver/details` is used as the observation point: it already
 * surfaces `computeUserBalances`'s `totalIncome`/`totalExpenses`/`netWorth`
 * fields directly (see balanceUtils.integration.test.ts).
 */

async function createAccount(token: string, openingBalance = 0, name = 'Checking') {
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

async function createTransaction(
    token: string,
    accountId: string,
    categoryId: string,
    type: 'income' | 'expense',
    amount: number,
    overrides: Record<string, unknown> = {}
) {
    return request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({
            type,
            title: `${type} tx`,
            amount,
            date: '2026-02-01T12:00:00.000Z',
            accountId,
            categoryId,
            ...overrides,
        })
}

describe('Balance engine reads lifetime totals from Transaction, not legacy Income/Expense (BUG-01)', () => {
    it('reflects Transaction income/expense sums with no legacy rows present', async () => {
        const { token } = await registerUser(app, { email: 'balance-c1-a@example.com' })
        const account = await createAccount(token, 1000)
        const categoryId = await getFoodMasterId(token)

        await createTransaction(token, account._id, categoryId, 'income', 500)
        await createTransaction(token, account._id, categoryId, 'expense', 200)

        expect(await Income.countDocuments({})).toBe(0)
        expect(await Expense.countDocuments({})).toBe(0)

        const res = await request(app).get('/api/v1/saver/details').set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.data.totalIncome).toBe(500)
        expect(res.body.data.data.totalExpenses).toBe(200)
    })

    it('ignores legacy Income/Expense rows entirely once Transaction data exists', async () => {
        const { token, userId } = await registerUser(app, { email: 'balance-c1-b@example.com' })
        const account = await createAccount(token, 1000)
        const categoryId = await getFoodMasterId(token)

        // Legacy rows a migrated user might still have on disk.
        await Income.create({ userId, title: 'Old salary', amount: 99999, date: new Date('2025-01-01') })
        await Expense.create({
            userId,
            title: 'Old rent',
            amount: 88888,
            category: 'Other',
            date: new Date('2025-01-01'),
        })

        await createTransaction(token, account._id, categoryId, 'income', 700)
        await createTransaction(token, account._id, categoryId, 'expense', 300)

        const res = await request(app).get('/api/v1/saver/details').set(authHeader(token))

        expect(res.body.data.data.totalIncome).toBe(700)
        expect(res.body.data.data.totalExpenses).toBe(300)
    })

    it('excludes draft transactions from lifetime totals', async () => {
        const { token } = await registerUser(app, { email: 'balance-c1-c@example.com' })
        const account = await createAccount(token, 1000)
        const categoryId = await getFoodMasterId(token)

        await createTransaction(token, account._id, categoryId, 'expense', 150)
        await createTransaction(token, account._id, categoryId, 'expense', 9999, { status: 'draft' })

        const res = await request(app).get('/api/v1/saver/details').set(authHeader(token))

        expect(res.body.data.data.totalExpenses).toBe(150)
    })

    it('excludes transfers from lifetime income/expense totals', async () => {
        const { token } = await registerUser(app, { email: 'balance-c1-d@example.com' })
        const fromAccount = await createAccount(token, 1000, 'From')
        const toAccount = await createAccount(token, 0, 'To')
        const categoryId = await getFoodMasterId(token)

        await createTransaction(token, fromAccount._id, categoryId, 'expense', 100)
        await request(app)
            .post('/api/v1/transactions/transfer')
            .set(authHeader(token))
            .send({
                title: 'Move funds',
                amount: 250,
                date: '2026-02-01T12:00:00.000Z',
                fromAccountId: fromAccount._id,
                toAccountId: toAccount._id,
            })

        const res = await request(app).get('/api/v1/saver/details').set(authHeader(token))

        expect(res.body.data.data.totalExpenses).toBe(100)
    })

    it('scopes totals per user — one user\'s transactions do not leak into another\'s totals', async () => {
        const { token: tokenA } = await registerUser(app, { email: 'balance-c1-e@example.com' })
        const { token: tokenB } = await registerUser(app, { email: 'balance-c1-f@example.com' })

        const accountA = await createAccount(tokenA, 500)
        const categoryA = await getFoodMasterId(tokenA)
        await createTransaction(tokenA, accountA._id, categoryA, 'income', 1000)

        const resB = await request(app).get('/api/v1/saver/details').set(authHeader(tokenB))

        expect(resB.body.data.data.totalIncome).toBe(0)
    })
})
