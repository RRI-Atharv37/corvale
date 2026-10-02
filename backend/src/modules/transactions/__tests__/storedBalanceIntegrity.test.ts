import { describe, it, expect } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { Account } from '@modules/accounts'
import { recomputeAccountBalanceMajor } from '@modules/accounts/accountBalance'
import { authHeader, seedUserDirectly } from '@tests/helpers'

const NOW = new Date()
const monthsAgoFirst = (months: number): string =>
    new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - months, 1)).toISOString().slice(0, 10)

async function masterId(token: string, name: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const found = res.body.data.masters.find((m: { name: string }) => m.name === name)
    if (!found) throw new Error(`${name} master category not found`)
    return found._id
}

async function createAccount(
    token: string,
    overrides: Record<string, unknown> = {}
): Promise<{ _id: string }> {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name: 'Checking', type: 'checking', openingBalance: 1000, ...overrides })
    return res.body.data
}

async function expectStoredMatchesRecompute(accountId: string, expected?: number) {
    const account = await Account.findById(accountId)
    const recomputed = await recomputeAccountBalanceMajor(account!, account!.userId.toString())
    const stored =
        account!.balanceUnit === 'minor' ? account!.currentBalance / 100 : account!.currentBalance
    expect(stored).toBeCloseTo(recomputed, 2)
    if (expected !== undefined) {
        expect(stored).toBeCloseTo(expected, 2)
    }
}

async function postTransaction(token: string, body: Record<string, unknown>) {
    return request(app).post('/api/v1/transactions').set(authHeader(token)).send(body)
}

async function seedRule(token: string, accountId: string, categoryId: string, amount = 100) {
    const res = await request(app)
        .post('/api/v1/recurring-rules')
        .set(authHeader(token))
        .send({
            title: 'Gym',
            type: 'expense',
            amount,
            accountId,
            categoryId,
            interval: 'monthly',
            nextDueDate: monthsAgoFirst(2),
        })
    expect(res.status).toBe(201)
    return res.body.data._id as string
}

async function generateDrafts(token: string): Promise<Array<{ _id: string; amount: number }>> {
    const res = await request(app)
        .post('/api/v1/recurring-rules/generate-drafts')
        .set(authHeader(token))
    expect(res.status).toBe(200)
    return res.body.data
}

async function push(token: string, ops: Array<Record<string, unknown>>) {
    const res = await request(app).post('/api/v1/sync/push').set(authHeader(token)).send({ ops })
    expect(res.status).toBe(200)
    return res.body.data.results as Array<{ status: string; resultId: string | null }>
}

describe('S52 - drafts never move the stored balance (BUG-68)', () => {
    it('a POSTed draft leaves the balance alone, and a status flip moves it', async () => {
        const { token } = await seedUserDirectly({ email: 's52-draft-create@example.com' })
        const account = await createAccount(token)
        const categoryId = await masterId(token, 'Food')

        const created = await postTransaction(token, {
            type: 'expense',
            title: 'Maybe',
            amount: 50,
            date: '2026-09-15T12:00:00.000Z',
            accountId: account._id,
            categoryId,
            status: 'draft',
        })
        expect(created.status).toBe(201)
        await expectStoredMatchesRecompute(account._id, 1000)

        const posted = await request(app)
            .put(`/api/v1/transactions/${created.body.data._id}`)
            .set(authHeader(token))
            .send({ status: 'posted' })
        expect(posted.status).toBe(200)
        await expectStoredMatchesRecompute(account._id, 950)

        const back = await request(app)
            .put(`/api/v1/transactions/${created.body.data._id}`)
            .set(authHeader(token))
            .send({ status: 'draft' })
        expect(back.status).toBe(200)
        await expectStoredMatchesRecompute(account._id, 1000)
    })

    it('delete, edit and duplicate of recurring drafts leave the balance alone until confirm', async () => {
        const { token } = await seedUserDirectly({ email: 's52-draft-lifecycle@example.com' })
        const account = await createAccount(token)
        const categoryId = await masterId(token, 'Food')
        await seedRule(token, account._id, categoryId)

        const drafts = await generateDrafts(token)
        expect(drafts.length).toBeGreaterThanOrEqual(2)
        await expectStoredMatchesRecompute(account._id, 1000)

        const removed = await request(app)
            .delete(`/api/v1/transactions/${drafts[0]._id}`)
            .set(authHeader(token))
        expect(removed.status).toBe(200)
        await expectStoredMatchesRecompute(account._id, 1000)

        const edited = await request(app)
            .put(`/api/v1/transactions/${drafts[1]._id}`)
            .set(authHeader(token))
            .send({ amount: 120 })
        expect(edited.status).toBe(200)
        await expectStoredMatchesRecompute(account._id, 1000)

        const duplicated = await request(app)
            .post(`/api/v1/transactions/duplicate/${drafts[1]._id}`)
            .set(authHeader(token))
        expect(duplicated.status).toBe(201)
        await expectStoredMatchesRecompute(account._id, 1000)

        const confirmed = await request(app)
            .post(`/api/v1/recurring-rules/drafts/${drafts[1]._id}/confirm`)
            .set(authHeader(token))
        expect(confirmed.status).toBe(200)
        await expectStoredMatchesRecompute(account._id, 880)

        const another = await postTransaction(token, {
            type: 'expense',
            title: 'Draft only',
            amount: 50,
            date: '2026-09-15T12:00:00.000Z',
            accountId: account._id,
            categoryId,
            status: 'draft',
        })
        expect(another.status).toBe(201)
        await expectStoredMatchesRecompute(account._id, 880)
    })

    it('deleting a confirmed (posted) recurring draft returns the money', async () => {
        const { token } = await seedUserDirectly({ email: 's52-draft-confirmed-delete@example.com' })
        const account = await createAccount(token)
        const categoryId = await masterId(token, 'Food')
        await seedRule(token, account._id, categoryId)
        const [draft] = await generateDrafts(token)

        await request(app)
            .post(`/api/v1/recurring-rules/drafts/${draft._id}/confirm`)
            .set(authHeader(token))
        await expectStoredMatchesRecompute(account._id, 900)

        await request(app).delete(`/api/v1/transactions/${draft._id}`).set(authHeader(token))
        await expectStoredMatchesRecompute(account._id, 1000)
    })

    it('applying a template dated before the balance-as-of date does not move the balance', async () => {
        const { token } = await seedUserDirectly({ email: 's52-template-date@example.com' })
        const account = await createAccount(token, { openingBalanceDate: '2026-09-01T00:00:00.000Z' })
        const categoryId = await masterId(token, 'Food')

        const template = await request(app)
            .post('/api/v1/transaction-templates')
            .set(authHeader(token))
            .send({ name: 'Old habit', type: 'expense', amount: 40, accountId: account._id, categoryId })
        expect(template.status).toBe(201)

        const before = await request(app)
            .post(`/api/v1/transaction-templates/${template.body.data._id}/apply`)
            .set(authHeader(token))
            .send({ date: '2026-08-15T12:00:00.000Z' })
        expect(before.status).toBe(201)
        await expectStoredMatchesRecompute(account._id, 1000)

        const after = await request(app)
            .post(`/api/v1/transaction-templates/${template.body.data._id}/apply`)
            .set(authHeader(token))
            .send({ date: '2026-09-15T12:00:00.000Z' })
        expect(after.status).toBe(201)
        await expectStoredMatchesRecompute(account._id, 960)
    })
})

describe('S52 - REST writes keep the stored balance equal to the ledger', () => {
    it('create, edit amount/date/account, duplicate and delete all stay in step', async () => {
        const { token } = await seedUserDirectly({ email: 's52-rest-steps@example.com' })
        const first = await createAccount(token, { openingBalanceDate: '2026-09-01T00:00:00.000Z' })
        const second = await createAccount(token, { name: 'Cash', type: 'cash', openingBalance: 200 })
        const categoryId = await masterId(token, 'Food')

        const created = await postTransaction(token, {
            type: 'expense',
            title: 'Lunch',
            amount: 30,
            date: '2026-09-10T12:00:00.000Z',
            accountId: first._id,
            categoryId,
        })
        const id = created.body.data._id
        await expectStoredMatchesRecompute(first._id, 970)

        await request(app).put(`/api/v1/transactions/${id}`).set(authHeader(token)).send({ amount: 45 })
        await expectStoredMatchesRecompute(first._id, 955)

        await request(app)
            .put(`/api/v1/transactions/${id}`)
            .set(authHeader(token))
            .send({ date: '2026-08-10T12:00:00.000Z' })
        await expectStoredMatchesRecompute(first._id, 1000)

        await request(app)
            .put(`/api/v1/transactions/${id}`)
            .set(authHeader(token))
            .send({ date: '2026-09-12T12:00:00.000Z', accountId: second._id })
        await expectStoredMatchesRecompute(first._id, 1000)
        await expectStoredMatchesRecompute(second._id, 155)

        const dup = await request(app)
            .post(`/api/v1/transactions/duplicate/${id}`)
            .set(authHeader(token))
        expect(dup.status).toBe(201)
        await expectStoredMatchesRecompute(second._id, 110)

        await request(app).delete(`/api/v1/transactions/${id}`).set(authHeader(token))
        await request(app).delete(`/api/v1/transactions/${dup.body.data._id}`).set(authHeader(token))
        await expectStoredMatchesRecompute(second._id, 200)
    })

    it('create, delete and bulk-delete of transfers keep both accounts in step', async () => {
        const { token } = await seedUserDirectly({ email: 's52-transfers@example.com' })
        const from = await createAccount(token)
        const to = await createAccount(token, { name: 'Savings', type: 'savings', openingBalance: 50 })

        const legs: Array<{ outbound: { _id: string }; inbound: { _id: string } }> = []
        for (let index = 0; index < 3; index += 1) {
            const res = await request(app)
                .post('/api/v1/transactions/transfer')
                .set(authHeader(token))
                .send({
                    title: `Move ${index}`,
                    amount: 100,
                    date: '2026-09-10T12:00:00.000Z',
                    fromAccountId: from._id,
                    toAccountId: to._id,
                })
            expect(res.status).toBe(201)
            legs.push(res.body.data)
        }
        await expectStoredMatchesRecompute(from._id, 700)
        await expectStoredMatchesRecompute(to._id, 350)

        await request(app)
            .delete(`/api/v1/transactions/${legs[0].inbound._id}`)
            .set(authHeader(token))
        await expectStoredMatchesRecompute(from._id, 800)
        await expectStoredMatchesRecompute(to._id, 250)

        const bulk = await request(app)
            .post('/api/v1/transactions/bulk/delete')
            .set(authHeader(token))
            .send({ transactionIds: [legs[1].outbound._id, legs[2].outbound._id] })
        expect(bulk.status).toBe(200)
        await expectStoredMatchesRecompute(from._id, 1000)
        await expectStoredMatchesRecompute(to._id, 50)
    })

    it('heals an account whose stored balance had already drifted', async () => {
        const { token } = await seedUserDirectly({ email: 's52-heal@example.com' })
        const account = await createAccount(token)
        const categoryId = await masterId(token, 'Food')
        await Account.updateOne({ _id: account._id }, { $set: { currentBalance: 1234 } })

        await postTransaction(token, {
            type: 'expense',
            title: 'Coffee',
            amount: 5,
            date: '2026-09-10T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })
        await expectStoredMatchesRecompute(account._id, 995)
    })
})

describe('S52 - sync-pushed transaction edits and deletes reach the stored balance (BUG-69)', () => {
    it('create, update and delete over /sync/push each leave the balance equal to the ledger', async () => {
        const { token } = await seedUserDirectly({ email: 's52-sync-steps@example.com' })
        const account = await createAccount(token)
        const categoryId = await masterId(token, 'Food')

        const [created] = await push(token, [
            {
                opId: 's52-create',
                entity: 'transaction',
                operation: 'create',
                payload: {
                    type: 'expense',
                    title: 'Sync spend',
                    amount: 10000,
                    date: '2026-09-15T12:00:00.000Z',
                    accountId: account._id,
                    categoryId,
                },
            },
        ])
        expect(created.status).toBe('applied')
        await expectStoredMatchesRecompute(account._id, 900)

        const [updated] = await push(token, [
            {
                opId: 's52-update',
                entity: 'transaction',
                operation: 'update',
                payload: { _id: created.resultId, amount: 25000 },
            },
        ])
        expect(updated.status).toBe('applied')
        await expectStoredMatchesRecompute(account._id, 750)

        const [toDraft] = await push(token, [
            {
                opId: 's52-draft',
                entity: 'transaction',
                operation: 'update',
                payload: { _id: created.resultId, status: 'draft' },
            },
        ])
        expect(toDraft.status).toBe('applied')
        await expectStoredMatchesRecompute(account._id, 1000)

        const [backToPosted] = await push(token, [
            {
                opId: 's52-posted',
                entity: 'transaction',
                operation: 'update',
                payload: { _id: created.resultId, status: 'posted' },
            },
        ])
        expect(backToPosted.status).toBe('applied')
        await expectStoredMatchesRecompute(account._id, 750)

        const [deleted] = await push(token, [
            {
                opId: 's52-delete',
                entity: 'transaction',
                operation: 'delete',
                payload: { _id: created.resultId },
            },
        ])
        expect(deleted.status).toBe('applied')
        await expectStoredMatchesRecompute(account._id, 1000)
    })

    it('a single batch that creates, edits and deletes settles on the ledger balance', async () => {
        const { token } = await seedUserDirectly({ email: 's52-sync-batch@example.com' })
        const account = await createAccount(token)
        const categoryId = await masterId(token, 'Food')
        const keepId = '66aa00000000000000000001'
        const dropId = '66aa00000000000000000002'
        const base = {
            type: 'expense',
            date: '2026-09-15T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        }

        const results = await push(token, [
            { opId: 'b-1', entity: 'transaction', operation: 'create', payload: { ...base, _id: keepId, title: 'Keep', amount: 2000 } },
            { opId: 'b-2', entity: 'transaction', operation: 'create', payload: { ...base, _id: dropId, title: 'Drop', amount: 3000 } },
            { opId: 'b-3', entity: 'transaction', operation: 'update', payload: { _id: keepId, amount: 5000 } },
            { opId: 'b-4', entity: 'transaction', operation: 'delete', payload: { _id: dropId } },
        ])
        expect(results.map((result) => result.status)).toEqual(['applied', 'applied', 'applied', 'applied'])
        await expectStoredMatchesRecompute(account._id, 950)
    })

    it('a synced transfer delete restores both accounts', async () => {
        const { token } = await seedUserDirectly({ email: 's52-sync-transfer@example.com' })
        const from = await createAccount(token)
        const to = await createAccount(token, { name: 'Savings', type: 'savings', openingBalance: 0 })

        const [transfer] = await push(token, [
            {
                opId: 's52-transfer',
                entity: 'transaction',
                operation: 'create',
                payload: {
                    intent: 'transaction.transfer',
                    amount: 4000,
                    date: '2026-09-15T12:00:00.000Z',
                    fromAccountId: from._id,
                    toAccountId: to._id,
                },
            },
        ])
        expect(transfer.status).toBe('applied')
        await expectStoredMatchesRecompute(from._id, 960)
        await expectStoredMatchesRecompute(to._id, 40)

        await push(token, [
            {
                opId: 's52-transfer-delete',
                entity: 'transaction',
                operation: 'delete',
                payload: { _id: transfer.resultId },
            },
        ])
        await expectStoredMatchesRecompute(from._id, 1000)
        await expectStoredMatchesRecompute(to._id, 0)
    })
})

describe('S52 - concurrent writes to one account do not lose updates (BUG-70)', () => {
    it('ten parallel $1 expenses debit the account ten times', async () => {
        const { token } = await seedUserDirectly({ email: 's52-concurrent-create@example.com' })
        const account = await createAccount(token)
        const categoryId = await masterId(token, 'Food')

        const responses = await Promise.all(
            Array.from({ length: 10 }, (_, index) =>
                postTransaction(token, {
                    type: 'expense',
                    title: `Parallel ${index}`,
                    amount: 1,
                    date: '2026-09-15T12:00:00.000Z',
                    accountId: account._id,
                    categoryId,
                })
            )
        )

        expect(responses.map((res) => res.status)).toEqual(Array(10).fill(201))
        await expectStoredMatchesRecompute(account._id, 990)
    })

    it('two parallel confirms of one draft post it exactly once', async () => {
        const { token } = await seedUserDirectly({ email: 's52-concurrent-confirm@example.com' })
        const account = await createAccount(token)
        const categoryId = await masterId(token, 'Food')
        await seedRule(token, account._id, categoryId)
        const [draft] = await generateDrafts(token)

        const responses = await Promise.all([
            request(app)
                .post(`/api/v1/recurring-rules/drafts/${draft._id}/confirm`)
                .set(authHeader(token)),
            request(app)
                .post(`/api/v1/recurring-rules/drafts/${draft._id}/confirm`)
                .set(authHeader(token)),
        ])

        expect(responses.map((res) => res.status).sort()).toEqual([200, 400])
        await expectStoredMatchesRecompute(account._id, 900)
    })

    it('a sync push landing while REST writes run keeps every debit', async () => {
        const { token } = await seedUserDirectly({ email: 's52-concurrent-mixed@example.com' })
        const account = await createAccount(token)
        const categoryId = await masterId(token, 'Food')
        const base = {
            type: 'expense',
            date: '2026-09-15T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        }

        await Promise.all([
            ...Array.from({ length: 4 }, (_, index) =>
                postTransaction(token, { ...base, title: `Rest ${index}`, amount: 1 })
            ),
            push(token, [
                { opId: 'mix-1', entity: 'transaction', operation: 'create', payload: { ...base, title: 'Sync 1', amount: 100 } },
                { opId: 'mix-2', entity: 'transaction', operation: 'create', payload: { ...base, title: 'Sync 2', amount: 100 } },
            ]),
        ])

        // REST amounts are major units, sync payloads minor: 1000 - 4 x 1.00 - 2 x 1.00
        await expectStoredMatchesRecompute(account._id, 994)
    })

    it('ten parallel savings-goal contributions all count', async () => {
        const { token } = await seedUserDirectly({ email: 's52-concurrent-goal@example.com' })
        const goal = await request(app)
            .post('/api/v1/savings-goals')
            .set(authHeader(token))
            .send({ name: 'Trip', targetAmount: 5000 })
        expect(goal.status).toBe(201)

        const responses = await Promise.all(
            Array.from({ length: 10 }, () =>
                request(app)
                    .post(`/api/v1/savings-goals/${goal.body.data._id}/contribute`)
                    .set(authHeader(token))
                    .send({ amount: 1 })
            )
        )
        expect(responses.map((res) => res.status)).toEqual(Array(10).fill(200))

        const progress = await request(app)
            .get(`/api/v1/savings-goals/${goal.body.data._id}/progress`)
            .set(authHeader(token))
        expect(progress.body.data.currentAmount).toBe(10)
    })
})

describe('S52 - concurrent draft generation creates each due date once (BUG-70)', () => {
    it('parallel generate-drafts calls yield one draft per due date', async () => {
        const { token } = await seedUserDirectly({ email: 's52-concurrent-generate@example.com' })
        const account = await createAccount(token)
        const categoryId = await masterId(token, 'Food')
        const ruleId = await seedRule(token, account._id, categoryId)

        const responses = await Promise.all([
            request(app).post('/api/v1/recurring-rules/generate-drafts').set(authHeader(token)),
            request(app).post('/api/v1/recurring-rules/generate-drafts').set(authHeader(token)),
            request(app)
                .post(`/api/v1/recurring-rules/${ruleId}/generate-drafts`)
                .set(authHeader(token)),
        ])
        expect(responses.map((res) => res.status)).toEqual([200, 200, 200])

        const drafts = await request(app)
            .get(`/api/v1/recurring-rules/drafts?ruleId=${ruleId}`)
            .set(authHeader(token))
        const dates = drafts.body.data.map((draft: { date: string }) => draft.date)
        expect(dates.length).toBeGreaterThanOrEqual(3)
        expect(new Set(dates).size).toBe(dates.length)
        await expectStoredMatchesRecompute(account._id, 1000)
    })

    it('a single generate call still advances the rule past every generated due date', async () => {
        const { token } = await seedUserDirectly({ email: 's52-generate-advance@example.com' })
        const account = await createAccount(token)
        const categoryId = await masterId(token, 'Food')
        const ruleId = await seedRule(token, account._id, categoryId)
        const before = await request(app)
            .get(`/api/v1/recurring-rules/${ruleId}`)
            .set(authHeader(token))

        await request(app)
            .post(`/api/v1/recurring-rules/${ruleId}/generate-drafts`)
            .set(authHeader(token))
        const after = await request(app)
            .get(`/api/v1/recurring-rules/${ruleId}`)
            .set(authHeader(token))

        expect(new Date(after.body.data.nextDueDate).getTime()).toBeGreaterThan(
            new Date(before.body.data.nextDueDate).getTime()
        )
    })
})
