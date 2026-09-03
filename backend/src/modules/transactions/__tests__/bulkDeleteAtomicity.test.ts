import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Account } from '@modules/accounts'
import { Transaction } from '@modules/transactions'
import { authHeader, seedUserDirectly } from '@tests/helpers'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

/**
 * Acceptance spec for bulk-delete atomicity (C3, BUG-03, SEC-14 folded in as S6).
 *
 * `bulkDeleteTransactions` (transactionController.ts) currently loops over
 * `transactionIds` and deletes each one immediately, throwing the instant it
 * hits an id that doesn't exist or isn't the caller's — after already
 * having permanently deleted (and reversed the balance for) every id that
 * came before it in the array. The fix: validate every id up front, then
 * delete only once all pass, wrapped so a mid-loop failure cannot leave a
 * partial deletion behind. The redundant standalone `findById` (which
 * currently 404s for "doesn't exist" but lets a separate
 * `validateResourceAccess` call 403 for "exists but isn't yours") must
 * collapse into a single uniform 404 for both cases, scoped to this
 * endpoint (S6) — see BUG-03 / SEC-14.
 */

async function createTestAccount(token: string, openingBalance = 500, name = 'Checking') {
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

async function createExpense(token: string, accountId: string, categoryId: string, title: string, amount: number) {
    const res = await request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({ type: 'expense', title, amount, date: '2026-01-15T12:00:00.000Z', accountId, categoryId })
    return res.body.data
}

describe('bulkDeleteTransactions is all-or-nothing (BUG-03)', () => {
    it('deletes nothing when one id in the batch does not exist', async () => {
        const { token } = await seedUserDirectly({ email: 'bulk-atomic-a@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const first = await createExpense(token, account._id, categoryId, 'Coffee', 5)
        const second = await createExpense(token, account._id, categoryId, 'Lunch', 15)
        const bogusId = '507f1f77bcf86cd799439011'

        const res = await request(app)
            .post('/api/v1/transactions/bulk/delete')
            .set(authHeader(token))
            .send({ transactionIds: [first._id, second._id, bogusId] })

        expect(res.status).toBe(404)

        expect(await Transaction.countDocuments({ userId: first.userId })).toBe(2)
        expect(await Transaction.findById(first._id)).not.toBeNull()
        expect(await Transaction.findById(second._id)).not.toBeNull()

        const updatedAccount = await Account.findById(account._id)
        expect(updatedAccount?.currentBalance).toBe(500 - 5 - 15)
    })

    it('deletes nothing when one id belongs to another user', async () => {
        const { token: ownerToken } = await seedUserDirectly({ email: 'bulk-atomic-b-owner@example.com' })
        const { token: otherToken } = await seedUserDirectly({ email: 'bulk-atomic-b-other@example.com' })

        const ownerAccount = await createTestAccount(ownerToken)
        const ownerCategoryId = await getFoodMasterId(ownerToken)
        const ownerFirst = await createExpense(ownerToken, ownerAccount._id, ownerCategoryId, 'Groceries', 20)
        const ownerSecond = await createExpense(ownerToken, ownerAccount._id, ownerCategoryId, 'Snacks', 8)

        const otherAccount = await createTestAccount(otherToken, 200)
        const otherCategoryId = await getFoodMasterId(otherToken)
        const otherExpense = await createExpense(otherToken, otherAccount._id, otherCategoryId, 'Not yours', 50)

        const res = await request(app)
            .post('/api/v1/transactions/bulk/delete')
            .set(authHeader(ownerToken))
            .send({ transactionIds: [ownerFirst._id, ownerSecond._id, otherExpense._id] })

        expect(res.status).toBe(404)

        expect(await Transaction.findById(ownerFirst._id)).not.toBeNull()
        expect(await Transaction.findById(ownerSecond._id)).not.toBeNull()
        expect(await Transaction.findById(otherExpense._id)).not.toBeNull()

        const updatedOwnerAccount = await Account.findById(ownerAccount._id)
        expect(updatedOwnerAccount?.currentBalance).toBe(500 - 20 - 8)
    })

    it('still deletes and updates the balance correctly when every id is valid', async () => {
        const { token } = await seedUserDirectly({ email: 'bulk-atomic-c@example.com' })
        const account = await createTestAccount(token)
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
    })
})

describe('bulkDeleteTransactions gives a uniform 404 (SEC-14, folded into C3 as S6)', () => {
    it('returns the same status and message for "does not exist" and "belongs to another user"', async () => {
        const { token: ownerToken } = await seedUserDirectly({ email: 'bulk-uniform-owner@example.com' })
        const { token: otherToken } = await seedUserDirectly({ email: 'bulk-uniform-other@example.com' })

        const otherAccount = await createTestAccount(otherToken)
        const otherCategoryId = await getFoodMasterId(otherToken)
        const otherExpense = await createExpense(otherToken, otherAccount._id, otherCategoryId, 'Private', 10)

        const notFoundRes = await request(app)
            .post('/api/v1/transactions/bulk/delete')
            .set(authHeader(ownerToken))
            .send({ transactionIds: ['507f1f77bcf86cd799439011'] })

        const notYoursRes = await request(app)
            .post('/api/v1/transactions/bulk/delete')
            .set(authHeader(ownerToken))
            .send({ transactionIds: [otherExpense._id] })

        expect(notFoundRes.status).toBe(notYoursRes.status)
        expect(notFoundRes.status).toBe(404)
        expect(notFoundRes.body.message).toBe(ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND)
        expect(notYoursRes.body.message).toBe(ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND)
    })
})
