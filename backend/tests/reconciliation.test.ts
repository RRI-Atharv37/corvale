import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import Transaction from '../models/Transaction'
import Account from '../models/Account'
import { authHeader, seedUserDirectly } from './helpers'

/**
 * Sprint 12.1 acceptance criteria for account reconciliation (clearedStatus and reconciliation sessions).
 *
 * Contract defined by these tests (implementation must satisfy):
 *   PATCH /api/v1/transactions/:id/cleared-status
 *     -> update clearedStatus to 'pending' | 'cleared' | 'reconciled'
 *     -> optional reconciledAt timestamp
 *
 *   POST /api/v1/reconciliation-sessions
 *     -> create reconciliation session with statementEndDate, statementBalance
 *     -> match to account and reconciled transactions
 *     -> return cleared vs pending balance differential
 *
 *   GET /api/v1/transactions (with filters)
 *     -> filter by clearedStatus=cleared|pending|reconciled
 */

async function createTestAccount(token: string, name = 'Checking', openingBalance = 1000) {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'checking', openingBalance })
    return res.body.data
}

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const food = res.body.data.masters.find((m: { name: string }) => m.name === 'Food')
    return food._id
}

async function createTestTransaction(
    token: string,
    accountId: string,
    categoryId: string,
    amount: number,
    title = 'Test Transaction'
) {
    const res = await request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({
            type: 'expense',
            title,
            amount,
            date: new Date().toISOString(),
            accountId,
            categoryId,
        })
    return res.body.data
}

describe('Reconciliation - Transaction clearedStatus', () => {
    it('requires authentication', async () => {
        const res = await request(app).patch('/api/v1/transactions/some-id/cleared-status').send({
            clearedStatus: 'cleared',
        })
        expect(res.status).toBe(401)
    })

    it('creates a transaction with default clearedStatus of pending', async () => {
        const { token } = await seedUserDirectly({ email: 'reconcile-default@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const res = await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(token))
            .send({
                type: 'expense',
                title: 'Test',
                amount: 50,
                date: new Date().toISOString(),
                accountId: account._id,
                categoryId,
            })

        expect(res.status).toBe(201)
        expect(res.body.data.clearedStatus).toBe('pending')
        expect(res.body.data.reconciledAt).toBeNull()
    })

    it('marks a transaction as cleared', async () => {
        const { token } = await seedUserDirectly({ email: 'reconcile-mark-cleared@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)
        const tx = await createTestTransaction(token, account._id, categoryId, 50, 'Test')

        const res = await request(app)
            .patch(`/api/v1/transactions/${tx._id}/cleared-status`)
            .set(authHeader(token))
            .send({ clearedStatus: 'cleared' })

        expect(res.status).toBe(200)
        expect(res.body.data.clearedStatus).toBe('cleared')

        const stored = await Transaction.findById(tx._id)
        expect(stored?.clearedStatus).toBe('cleared')
    })

    it('marks a transaction as reconciled with timestamp', async () => {
        const { token } = await seedUserDirectly({ email: 'reconcile-mark-reconciled@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)
        const tx = await createTestTransaction(token, account._id, categoryId, 50, 'Test')
        const now = new Date()

        const res = await request(app)
            .patch(`/api/v1/transactions/${tx._id}/cleared-status`)
            .set(authHeader(token))
            .send({ clearedStatus: 'reconciled', reconciledAt: now.toISOString() })

        expect(res.status).toBe(200)
        expect(res.body.data.clearedStatus).toBe('reconciled')
        expect(res.body.data.reconciledAt).toBeDefined()

        const stored = await Transaction.findById(tx._id)
        expect(stored?.clearedStatus).toBe('reconciled')
        expect(stored?.reconciledAt).toBeDefined()
    })

    it('resets clearedStatus back to pending', async () => {
        const { token } = await seedUserDirectly({ email: 'reconcile-reset@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)
        const tx = await createTestTransaction(token, account._id, categoryId, 50, 'Test')

        await request(app)
            .patch(`/api/v1/transactions/${tx._id}/cleared-status`)
            .set(authHeader(token))
            .send({ clearedStatus: 'cleared' })

        const res = await request(app)
            .patch(`/api/v1/transactions/${tx._id}/cleared-status`)
            .set(authHeader(token))
            .send({ clearedStatus: 'pending' })

        expect(res.status).toBe(200)
        expect(res.body.data.clearedStatus).toBe('pending')
    })

    it('rejects invalid clearedStatus values', async () => {
        const { token } = await seedUserDirectly({ email: 'reconcile-invalid@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)
        const tx = await createTestTransaction(token, account._id, categoryId, 50, 'Test')

        const res = await request(app)
            .patch(`/api/v1/transactions/${tx._id}/cleared-status`)
            .set(authHeader(token))
            .send({ clearedStatus: 'invalid' })

        expect(res.status).toBe(400)
    })

    it('prevents unauthorized user from updating another user\'s transaction', async () => {
        const user1 = await seedUserDirectly({ email: 'reconcile-user1@example.com' })
        const user2 = await seedUserDirectly({ email: 'reconcile-user2@example.com' })

        const account = await createTestAccount(user1.token)
        const categoryId = await getFoodMasterId(user1.token)
        const tx = await createTestTransaction(user1.token, account._id, categoryId, 50, 'Test')

        const res = await request(app)
            .patch(`/api/v1/transactions/${tx._id}/cleared-status`)
            .set(authHeader(user2.token))
            .send({ clearedStatus: 'cleared' })

        expect(res.status).toBe(403)
    })
})

describe('Reconciliation - Transaction filters', () => {
    it('filters transactions by clearedStatus=cleared', async () => {
        const { token } = await seedUserDirectly({ email: 'filter-cleared@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const tx1 = await createTestTransaction(token, account._id, categoryId, 50, 'Cleared')
        const tx2 = await createTestTransaction(token, account._id, categoryId, 30, 'Pending')

        await request(app)
            .patch(`/api/v1/transactions/${tx1._id}/cleared-status`)
            .set(authHeader(token))
            .send({ clearedStatus: 'cleared' })

        const res = await request(app)
            .get('/api/v1/transactions?clearedStatus=cleared')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.data).toHaveLength(1)
        expect(res.body.data.data[0]._id).toBe(tx1._id)
    })

    it('filters transactions by clearedStatus=pending', async () => {
        const { token } = await seedUserDirectly({ email: 'filter-pending@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const tx1 = await createTestTransaction(token, account._id, categoryId, 50, 'Cleared')
        const tx2 = await createTestTransaction(token, account._id, categoryId, 30, 'Pending')

        await request(app)
            .patch(`/api/v1/transactions/${tx1._id}/cleared-status`)
            .set(authHeader(token))
            .send({ clearedStatus: 'cleared' })

        const res = await request(app)
            .get('/api/v1/transactions?clearedStatus=pending')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.data).toHaveLength(1)
        expect(res.body.data.data[0]._id).toBe(tx2._id)
    })

    it('filters transactions by clearedStatus=reconciled', async () => {
        const { token } = await seedUserDirectly({ email: 'filter-reconciled@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const tx1 = await createTestTransaction(token, account._id, categoryId, 50, 'Reconciled')
        const tx2 = await createTestTransaction(token, account._id, categoryId, 30, 'Pending')

        await request(app)
            .patch(`/api/v1/transactions/${tx1._id}/cleared-status`)
            .set(authHeader(token))
            .send({
                clearedStatus: 'reconciled',
                reconciledAt: new Date().toISOString(),
            })

        const res = await request(app)
            .get('/api/v1/transactions?clearedStatus=reconciled')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.data).toHaveLength(1)
        expect(res.body.data.data[0]._id).toBe(tx1._id)
    })

    it('returns empty array for clearedStatus filter with no matches', async () => {
        const { token } = await seedUserDirectly({ email: 'filter-empty@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        await createTestTransaction(token, account._id, categoryId, 50)

        const res = await request(app)
            .get('/api/v1/transactions?clearedStatus=cleared')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.data).toHaveLength(0)
    })

    it('filters by clearedStatus on the date-range filter endpoint too', async () => {
        const { token } = await seedUserDirectly({ email: 'filter-daterange@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const tx1 = await createTestTransaction(token, account._id, categoryId, 50, 'Cleared')
        await createTestTransaction(token, account._id, categoryId, 30, 'Pending')

        await request(app)
            .patch(`/api/v1/transactions/${tx1._id}/cleared-status`)
            .set(authHeader(token))
            .send({ clearedStatus: 'cleared' })

        const today = new Date().toISOString().slice(0, 10)
        const res = await request(app)
            .get(`/api/v1/transactions/filter?startDate=${today}&endDate=${today}&clearedStatus=cleared`)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data).toHaveLength(1)
        expect(res.body.data[0]._id).toBe(tx1._id)
    })

    it('filters transactions by accountId, needed to scope the reconciliation UI to one account', async () => {
        const { token } = await seedUserDirectly({ email: 'filter-accountid@example.com' })
        const accountA = await createTestAccount(token, 'Account A')
        const accountB = await createTestAccount(token, 'Account B')
        const categoryId = await getFoodMasterId(token)

        const txA = await createTestTransaction(token, accountA._id, categoryId, 50, 'In A')
        await createTestTransaction(token, accountB._id, categoryId, 30, 'In B')

        const res = await request(app)
            .get(`/api/v1/transactions?accountId=${accountA._id}`)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.data).toHaveLength(1)
        expect(res.body.data.data[0]._id).toBe(txA._id)
    })
})

describe('Reconciliation - Reconciliation sessions', () => {
    it('requires authentication', async () => {
        const res = await request(app).post('/api/v1/reconciliation-sessions').send({
            accountId: 'some-id',
            statementEndDate: new Date().toISOString(),
            statementBalance: 1000,
        })
        expect(res.status).toBe(401)
    })

    it('creates a reconciliation session for an account', async () => {
        const { token } = await seedUserDirectly({ email: 'recon-session@example.com' })
        const account = await createTestAccount(token, 'Test', 1000)
        const statementDate = new Date().toISOString()
        const statementBalance = 950

        const res = await request(app)
            .post('/api/v1/reconciliation-sessions')
            .set(authHeader(token))
            .send({
                accountId: account._id,
                statementEndDate: statementDate,
                statementBalance,
            })

        expect(res.status).toBe(201)
        expect(res.body.data.accountId).toBe(account._id)
        expect(res.body.data.statementEndDate).toBeDefined()
        expect(res.body.data.statementBalance).toBe(statementBalance)
        expect(res.body.data.createdAt).toBeDefined()
    })

    it('reconciliation session returns cleared/pending balances as absolute and delta amounts', async () => {
        const { token } = await seedUserDirectly({ email: 'recon-balances@example.com' })
        const account = await createTestAccount(token, 'Test', 1000)
        const categoryId = await getFoodMasterId(token)

        const cleared = await createTestTransaction(token, account._id, categoryId, 25, 'Cleared')
        await createTestTransaction(token, account._id, categoryId, 25, 'Pending')

        await request(app)
            .patch(`/api/v1/transactions/${cleared._id}/cleared-status`)
            .set(authHeader(token))
            .send({ clearedStatus: 'cleared' })

        const res = await request(app)
            .post('/api/v1/reconciliation-sessions')
            .set(authHeader(token))
            .send({
                accountId: account._id,
                statementEndDate: new Date().toISOString(),
                statementBalance: 950,
            })

        expect(res.status).toBe(201)
        // clearedBalance is opening balance (1000) plus the one cleared $25 expense.
        expect(res.body.data.clearedBalance).toBe(975)
        // pendingBalance is just the outstanding $25 expense as a delta, not opening-balance-relative.
        expect(res.body.data.pendingBalance).toBe(-25)
    })

    it('reconciliation session calculates balance differential from the cleared balance, not the live account balance', async () => {
        const { token } = await seedUserDirectly({ email: 'recon-diff@example.com' })
        const account = await createTestAccount(token, 'Test', 1000)
        const categoryId = await getFoodMasterId(token)

        // Pending (not yet cleared) - doesn't affect clearedBalance.
        await createTestTransaction(token, account._id, categoryId, 50)

        const res = await request(app)
            .post('/api/v1/reconciliation-sessions')
            .set(authHeader(token))
            .send({
                accountId: account._id,
                statementEndDate: new Date().toISOString(),
                statementBalance: 950,
            })

        expect(res.status).toBe(201)
        // clearedBalance is still the full opening balance (1000) since nothing has cleared yet.
        expect(res.body.data.clearedBalance).toBe(1000)
        expect(res.body.data.balanceDifferential).toBe(50)
    })

    it('excludes transactions dated after the statement end date from the cleared balance', async () => {
        const { token } = await seedUserDirectly({ email: 'recon-future@example.com' })
        const account = await createTestAccount(token, 'Test', 1000)
        const categoryId = await getFoodMasterId(token)

        const statementDate = new Date()
        const futureDate = new Date(statementDate)
        futureDate.setUTCDate(futureDate.getUTCDate() + 5)

        const futureRes = await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(token))
            .send({
                type: 'expense',
                title: 'Future cleared expense',
                amount: 40,
                date: futureDate.toISOString(),
                accountId: account._id,
                categoryId,
            })

        await request(app)
            .patch(`/api/v1/transactions/${futureRes.body.data._id}/cleared-status`)
            .set(authHeader(token))
            .send({ clearedStatus: 'cleared' })

        const res = await request(app)
            .post('/api/v1/reconciliation-sessions')
            .set(authHeader(token))
            .send({
                accountId: account._id,
                statementEndDate: statementDate.toISOString(),
                statementBalance: 1000,
            })

        expect(res.status).toBe(201)
        // The future-dated cleared expense must not be included even though it's cleared.
        expect(res.body.data.clearedBalance).toBe(1000)
        expect(res.body.data.balanceDifferential).toBe(0)
    })

    it('prevents reconciliation of non-existent account', async () => {
        const { token } = await seedUserDirectly({ email: 'recon-notfound@example.com' })

        const res = await request(app)
            .post('/api/v1/reconciliation-sessions')
            .set(authHeader(token))
            .send({
                accountId: '000000000000000000000000',
                statementEndDate: new Date().toISOString(),
                statementBalance: 1000,
            })

        expect(res.status).toBe(404)
    })

    it('prevents unauthorized access to another user\'s reconciliation', async () => {
        const user1 = await seedUserDirectly({ email: 'recon-user1@example.com' })
        const user2 = await seedUserDirectly({ email: 'recon-user2@example.com' })

        const account = await createTestAccount(user1.token)

        const res = await request(app)
            .post('/api/v1/reconciliation-sessions')
            .set(authHeader(user2.token))
            .send({
                accountId: account._id,
                statementEndDate: new Date().toISOString(),
                statementBalance: 1000,
            })

        expect(res.status).toBe(403)
    })

    it('retrieves reconciliation session for an account', async () => {
        const { token } = await seedUserDirectly({ email: 'recon-retrieve@example.com' })
        const account = await createTestAccount(token)
        const statementDate = new Date().toISOString()

        await request(app)
            .post('/api/v1/reconciliation-sessions')
            .set(authHeader(token))
            .send({
                accountId: account._id,
                statementEndDate: statementDate,
                statementBalance: 950,
            })

        const res = await request(app)
            .get(`/api/v1/accounts/${account._id}/reconciliation-sessions`)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data).toHaveLength(1)
        expect(res.body.data[0].accountId).toBe(account._id)
    })
})

describe('Reconciliation - openingBalanceDate', () => {
    it('excludes transactions dated before openingBalanceDate from the cleared balance', async () => {
        const { token } = await seedUserDirectly({ email: 'reconcile-obd@example.com' })
        const accountRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({
                name: 'Checking',
                type: 'checking',
                openingBalance: 1000,
                openingBalanceDate: '2026-08-01T00:00:00.000Z',
            })
        const account = accountRes.body.data
        const foodId = await getFoodMasterId(token)

        // pre-cutoff expense, marked cleared - must NOT be summed again (it is
        // already baked into openingBalance)
        const preCutoff = (
            await request(app)
                .post('/api/v1/transactions')
                .set(authHeader(token))
                .send({
                    type: 'expense',
                    title: 'Historical',
                    amount: 300,
                    date: '2026-07-01T12:00:00.000Z',
                    accountId: account._id,
                    categoryId: foodId,
                })
        ).body.data
        // post-cutoff expense, cleared
        const postCutoff = (
            await request(app)
                .post('/api/v1/transactions')
                .set(authHeader(token))
                .send({
                    type: 'expense',
                    title: 'Recent',
                    amount: 50,
                    date: '2026-08-10T12:00:00.000Z',
                    accountId: account._id,
                    categoryId: foodId,
                })
        ).body.data

        for (const id of [preCutoff._id, postCutoff._id]) {
            await request(app)
                .patch(`/api/v1/transactions/${id}/cleared-status`)
                .set(authHeader(token))
                .send({ clearedStatus: 'cleared' })
        }

        const res = await request(app)
            .post('/api/v1/reconciliation-sessions')
            .set(authHeader(token))
            .send({
                accountId: account._id,
                statementEndDate: '2026-08-31T00:00:00.000Z',
                statementBalance: 950,
            })

        expect(res.status).toBe(201)
        // 1000 opening - 50 post-cutoff only (pre-cutoff 300 is not re-counted)
        expect(res.body.data.clearedBalance).toBe(950)
        expect(res.body.data.balanceDifferential).toBe(0)
    })
})
