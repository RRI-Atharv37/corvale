import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Transaction } from '@modules/transactions'
import { authHeader, seedUserDirectly } from '@tests/helpers'

async function createAccount(
    token: string,
    body: Record<string, unknown> = {}
): Promise<{ _id: string }> {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name: 'Checking', type: 'checking', openingBalance: 1000, ...body })
    expect(res.status).toBe(201)
    return res.body.data
}

async function masterCategoryId(token: string, name: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    return res.body.data.masters.find((m: { name: string }) => m.name === name)._id
}

async function createExpense(
    token: string,
    accountId: string,
    categoryId: string,
    amount: number,
    extra: Record<string, unknown> = {}
) {
    const res = await request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({
            type: 'expense',
            title: 'Spend',
            amount,
            date: '2026-01-10T12:00:00.000Z',
            accountId,
            categoryId,
            ...extra,
        })
    expect(res.status).toBe(201)
    return res.body.data
}

const clearEverything = (accountId: string) =>
    Transaction.updateMany({ accountId }, { $set: { clearedStatus: 'cleared' } })

const createSession = (token: string, accountId: string, statementBalance: number) =>
    request(app)
        .post('/api/v1/reconciliation-sessions')
        .set(authHeader(token))
        .send({
            accountId,
            statementEndDate: '2026-01-31T00:00:00.000Z',
            statementBalance,
        })

describe('Reconciliation session - transfers (BUG-76)', () => {
    it('a credit card with a transfer payment reconciles to zero', async () => {
        const { token } = await seedUserDirectly({ email: 'recon-card-transfer@example.com' })
        const checking = await createAccount(token, { name: 'Checking', openingBalance: 1000 })
        const card = await createAccount(token, { name: 'Card', type: 'credit', openingBalance: 500 })
        const categoryId = await masterCategoryId(token, 'Food')

        await createExpense(token, card._id, categoryId, 100)
        const transfer = await request(app)
            .post('/api/v1/transactions/transfer')
            .set(authHeader(token))
            .send({
                title: 'Card payment',
                amount: 300,
                date: '2026-01-12T12:00:00.000Z',
                fromAccountId: checking._id,
                toAccountId: card._id,
            })
        expect(transfer.status).toBe(201)

        await clearEverything(card._id)

        // 500 owed + 100 spent - 300 paid
        const res = await createSession(token, card._id, 300)

        expect(res.status).toBe(201)
        expect(res.body.data.clearedBalance).toBe(300)
        expect(res.body.data.pendingBalance).toBe(0)
        expect(res.body.data.balanceDifferential).toBe(0)
    })

    it('the outbound leg lowers the paying account and a pending leg lands in pendingBalance', async () => {
        const { token } = await seedUserDirectly({ email: 'recon-transfer-out@example.com' })
        const checking = await createAccount(token, { name: 'Checking', openingBalance: 1000 })
        const savings = await createAccount(token, { name: 'Savings', type: 'savings', openingBalance: 0 })

        const transfer = await request(app)
            .post('/api/v1/transactions/transfer')
            .set(authHeader(token))
            .send({
                title: 'To savings',
                amount: 250,
                date: '2026-01-12T12:00:00.000Z',
                fromAccountId: checking._id,
                toAccountId: savings._id,
            })
        expect(transfer.status).toBe(201)

        const pending = await createSession(token, checking._id, 1000)
        expect(pending.body.data.clearedBalance).toBe(1000)
        expect(pending.body.data.pendingBalance).toBe(-250)

        await clearEverything(checking._id)
        await clearEverything(savings._id)

        const checkingSession = await createSession(token, checking._id, 750)
        expect(checkingSession.body.data.clearedBalance).toBe(750)
        expect(checkingSession.body.data.balanceDifferential).toBe(0)

        const savingsSession = await createSession(token, savings._id, 250)
        expect(savingsSession.body.data.clearedBalance).toBe(250)
        expect(savingsSession.body.data.balanceDifferential).toBe(0)
    })
})

describe('Reconciliation session - split lines and drafts (BUG-76)', () => {
    it('counts a split once, through its parent', async () => {
        const { token } = await seedUserDirectly({ email: 'recon-split@example.com' })
        const account = await createAccount(token)
        const food = await masterCategoryId(token, 'Food')
        const transport = await masterCategoryId(token, 'Transport')

        await createExpense(token, account._id, food, 100, {
            splits: [
                { categoryId: food, amount: 60 },
                { categoryId: transport, amount: 40 },
            ],
        })
        await clearEverything(account._id)

        const res = await createSession(token, account._id, 900)

        expect(res.status).toBe(201)
        expect(res.body.data.clearedBalance).toBe(900)
        expect(res.body.data.pendingBalance).toBe(0)
        expect(res.body.data.balanceDifferential).toBe(0)
    })

    it('leaves split lines out of the pending balance', async () => {
        const { token } = await seedUserDirectly({ email: 'recon-split-pending@example.com' })
        const account = await createAccount(token)
        const food = await masterCategoryId(token, 'Food')
        const transport = await masterCategoryId(token, 'Transport')

        const parent = await createExpense(token, account._id, food, 100, {
            splits: [
                { categoryId: food, amount: 60 },
                { categoryId: transport, amount: 40 },
            ],
        })
        await Transaction.updateOne({ _id: parent._id }, { $set: { clearedStatus: 'cleared' } })

        const res = await createSession(token, account._id, 900)

        expect(res.body.data.clearedBalance).toBe(900)
        expect(res.body.data.pendingBalance).toBe(0)
    })

    it('ignores draft transactions', async () => {
        const { token } = await seedUserDirectly({ email: 'recon-draft@example.com' })
        const account = await createAccount(token)
        const food = await masterCategoryId(token, 'Food')

        const posted = await createExpense(token, account._id, food, 50)
        const draft = await createExpense(token, account._id, food, 70)
        await Transaction.updateOne({ _id: draft._id }, { $set: { status: 'draft' } })
        await clearEverything(account._id)

        const res = await createSession(token, account._id, 950)

        expect(posted._id).toBeDefined()
        expect(res.body.data.clearedBalance).toBe(950)
        expect(res.body.data.pendingBalance).toBe(0)
    })
})

describe('Reconciliation - candidate listing (BUG-76)', () => {
    it('an account with 250 reconciled rows still lists its newer rows', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'recon-250@example.com' })
        const account = await createAccount(token)
        const food = await masterCategoryId(token, 'Food')

        const base = {
            userId,
            accountId: account._id,
            categoryId: food,
            type: 'expense',
            amount: 100,
            currency: 'USD',
            title: 'Old',
        }
        await Transaction.insertMany(
            Array.from({ length: 250 }, (_, index) => ({
                ...base,
                date: new Date(Date.UTC(2025, 0, 1 + (index % 28))),
                clearedStatus: 'reconciled',
            }))
        )
        const newer = await createExpense(token, account._id, food, 12, { title: 'Newer' })

        const res = await request(app)
            .get(
                `/api/v1/transactions?accountId=${account._id}&clearedStatus=pending,cleared&status=posted&sortBy=date&sortOrder=asc&limit=200`
            )
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.meta.totalTransactions).toBe(1)
        expect(res.body.data.data.map((t: { _id: string }) => t._id)).toEqual([newer._id])
    })

    it('accepts a comma-separated clearedStatus and rejects an unknown member', async () => {
        const { token } = await seedUserDirectly({ email: 'recon-multi-status@example.com' })
        const account = await createAccount(token)
        const food = await masterCategoryId(token, 'Food')
        const pending = await createExpense(token, account._id, food, 10)
        const cleared = await createExpense(token, account._id, food, 20)
        const reconciled = await createExpense(token, account._id, food, 30)
        await Transaction.updateOne({ _id: cleared._id }, { $set: { clearedStatus: 'cleared' } })
        await Transaction.updateOne({ _id: reconciled._id }, { $set: { clearedStatus: 'reconciled' } })

        const ok = await request(app)
            .get(`/api/v1/transactions?accountId=${account._id}&clearedStatus=pending,cleared`)
            .set(authHeader(token))
        expect(ok.status).toBe(200)
        expect(ok.body.data.data.map((t: { _id: string }) => t._id).sort()).toEqual(
            [pending._id, cleared._id].sort()
        )

        const bad = await request(app)
            .get(`/api/v1/transactions?accountId=${account._id}&clearedStatus=pending,bogus`)
            .set(authHeader(token))
        expect(bad.status).toBe(400)
    })

    it('a workspace account lists its rows when the workspace is passed', async () => {
        const { token } = await seedUserDirectly({ email: 'recon-workspace@example.com' })
        const workspace = await request(app)
            .post('/api/v1/workspaces')
            .set(authHeader(token))
            .send({ name: 'Household' })
        expect(workspace.status).toBe(201)
        const workspaceId = workspace.body.data._id as string

        const account = await createAccount(token, { workspaceId })
        const food = await masterCategoryId(token, 'Food')
        const shared = await createExpense(token, account._id, food, 15, { workspaceId })

        const url = `/api/v1/transactions?accountId=${account._id}&clearedStatus=pending,cleared&status=posted`
        const withScope = await request(app).get(`${url}&workspaceId=${workspaceId}`).set(authHeader(token))
        expect(withScope.status).toBe(200)
        expect(withScope.body.data.data.map((t: { _id: string }) => t._id)).toEqual([shared._id])

        const session = await createSession(token, account._id, 985)
        expect(session.status).toBe(201)
        expect(String(session.body.data.workspaceId)).toBe(workspaceId)
    })
})

describe('Reconciliation - input hygiene (BUG-77)', () => {
    it('rejects a non-numeric statementBalance with 400', async () => {
        const { token } = await seedUserDirectly({ email: 'recon-bad-balance@example.com' })
        const account = await createAccount(token)

        const res = await createSession(token, account._id, 'lots' as unknown as number)

        expect(res.status).toBe(400)
    })

    it('rejects an unparseable statementEndDate with 400', async () => {
        const { token } = await seedUserDirectly({ email: 'recon-bad-date@example.com' })
        const account = await createAccount(token)

        const res = await request(app)
            .post('/api/v1/reconciliation-sessions')
            .set(authHeader(token))
            .send({ accountId: account._id, statementEndDate: 'not-a-date', statementBalance: 10 })

        expect(res.status).toBe(400)
    })

    it('rejects an invalid reconciledAt with 400', async () => {
        const { token } = await seedUserDirectly({ email: 'recon-bad-reconciled-at@example.com' })
        const account = await createAccount(token)
        const food = await masterCategoryId(token, 'Food')
        const tx = await createExpense(token, account._id, food, 10)

        const res = await request(app)
            .patch(`/api/v1/transactions/${tx._id}/cleared-status`)
            .set(authHeader(token))
            .send({ clearedStatus: 'reconciled', reconciledAt: 'yesterday-ish' })

        expect(res.status).toBe(400)
    })
})
