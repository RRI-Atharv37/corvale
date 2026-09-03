import request from 'supertest'
import { Application } from 'express'
import { createApp } from '@http/app'
import { Account } from '@modules/accounts'
import { Category } from '@modules/categories'
import { Transaction } from '@modules/transactions'
import { registerUser, authHeader, RegisteredUser } from '@tests/helpers'

/**
 * Acceptance spec for the `/api/v1/sync` surface. Contract assumed here (see the
 * "Phase 13 design decisions" architecture notes):
 *
 *   GET  /api/v1/sync/bootstrap?workspaceId=
 *     -> { success, data: { checkpoint, accounts, transactions, categories,
 *                            budgets, savingsGoals, tags, recurringRules } }
 *     Real `_id`s retained (client-generated ids are accepted on create
 *     elsewhere, see clientGeneratedId.test.ts, so bootstrap never remaps).
 *
 *   GET  /api/v1/sync/pull?checkpoint=&workspaceId=&limit=
 *     -> { success, data: { changes: [{ entity, doc }],
 *                            tombstones: [{ entity, _id, deletedAt }],
 *                            checkpoint, hasMore } }
 *     `checkpoint` is an opaque cursor round-tripping a stable
 *     (updatedAt, _id) tuple; ordering is ascending (updatedAt, _id) so two
 *     docs that update in the same millisecond still page deterministically.
 *
 *   POST /api/v1/sync/push  body: { ops: [{ opId, entity, operation,
 *                                            baseUpdatedAt?, payload }] }
 *     -> { success, data: { results: [{ opId, status, resultId?,
 *                                        conflict?, message? }], checkpoint } }
 *     Ops are dispatched in array order through the existing
 *     controller/service logic so side effects (balance updates, transfer
 *     pairing) still run. Multi-doc intents (`transaction.transfer`,
 *     `transaction.split`) apply atomically.
 *
 * None of this exists yet -- every request below is expected to 404 until
 * Sprint 13.3 lands. That's correct for a test-creation sprint.
 */

const seedAccount = async (userId: string, overrides: Partial<Record<string, unknown>> = {}) =>
    Account.create({
        userId,
        name: 'Checking',
        type: 'checking',
        currency: 'USD',
        openingBalance: 0,
        currentBalance: 0,
        ...overrides,
    })

const seedCategory = async (userId: string, name = 'Groceries') => Category.create({ userId, name })

describe('Sync API — bootstrap', () => {
    let app: Application
    let owner: RegisteredUser

    beforeEach(async () => {
        app = createApp()
        owner = await registerUser(app)
    })

    it('requires authentication', async () => {
        const res = await request(app).get('/api/v1/sync/bootstrap')
        expect(res.status).toBe(401)
    })

    it('returns a full scoped snapshot retaining real _ids plus an initial checkpoint', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const transaction = await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 2500,
            currency: 'USD',
            title: 'Coffee',
            date: new Date(),
        })

        const res = await request(app).get('/api/v1/sync/bootstrap').set(authHeader(owner.token))

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(typeof res.body.data.checkpoint).toBe('string')
        expect(res.body.data.accounts.map((a: { _id: string }) => a._id)).toContain(account._id.toString())
        expect(res.body.data.transactions.map((t: { _id: string }) => t._id)).toContain(
            transaction._id.toString()
        )
    })

    it('never returns another user\'s data', async () => {
        const other = await registerUser(app, { email: 'sync-other@example.com' })
        await seedAccount(other.userId)

        const res = await request(app).get('/api/v1/sync/bootstrap').set(authHeader(owner.token))

        expect(res.status).toBe(200)
        expect(res.body.data.accounts).toHaveLength(0)
    })

    it('rejects a workspaceId the caller is not a member of', async () => {
        const res = await request(app)
            .get('/api/v1/sync/bootstrap')
            .query({ workspaceId: '64b64b64b64b64b64b64b64b' })
            .set(authHeader(owner.token))

        expect(res.status).toBe(403)
    })
})

describe('Sync API — pull checkpoint pagination', () => {
    let app: Application
    let owner: RegisteredUser

    beforeEach(async () => {
        app = createApp()
        owner = await registerUser(app)
    })

    it('returns changes in ascending (updatedAt, _id) order', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)

        const first = await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 100,
            currency: 'USD',
            title: 'A',
            date: new Date(),
        })
        const second = await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 200,
            currency: 'USD',
            title: 'B',
            date: new Date(),
        })

        const res = await request(app)
            .get('/api/v1/sync/pull')
            .query({ checkpoint: '' })
            .set(authHeader(owner.token))

        expect(res.status).toBe(200)
        const transactionChanges = res.body.data.changes.filter(
            (c: { entity: string }) => c.entity === 'transaction'
        )
        const ids = transactionChanges.map((c: { doc: { _id: string } }) => c.doc._id)
        expect(ids.indexOf(first._id.toString())).toBeLessThan(ids.indexOf(second._id.toString()))
    })

    it('paginates without gaps or duplicates across pages', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        for (let i = 0; i < 5; i += 1) {
            await Transaction.create({
                userId: owner.userId,
                accountId: account._id,
                categoryId: category._id,
                type: 'expense',
                amount: 100 + i,
                currency: 'USD',
                title: `Tx ${i}`,
                date: new Date(),
            })
        }

        const seen = new Set<string>()
        let checkpoint = ''
        let hasMore = true
        let guard = 0

        while (hasMore && guard < 20) {
            guard += 1
            const res = await request(app)
                .get('/api/v1/sync/pull')
                .query({ checkpoint, limit: 2 })
                .set(authHeader(owner.token))

            expect(res.status).toBe(200)
            for (const change of res.body.data.changes) {
                const key = `${change.entity}:${change.doc._id}`
                expect(seen.has(key)).toBe(false)
                seen.add(key)
            }
            checkpoint = res.body.data.checkpoint
            hasMore = res.body.data.hasMore
        }

        expect(seen.size).toBeGreaterThanOrEqual(5)
    })

    it('breaks ties deterministically when two docs share the same updatedAt millisecond', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const now = new Date()

        const a = await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 100,
            currency: 'USD',
            title: 'Same instant A',
            date: now,
        })
        await Transaction.updateOne({ _id: a._id }, { $set: { updatedAt: now } })
        const b = await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 200,
            currency: 'USD',
            title: 'Same instant B',
            date: now,
        })
        await Transaction.updateOne({ _id: b._id }, { $set: { updatedAt: now } })

        const first = await request(app)
            .get('/api/v1/sync/pull')
            .query({ checkpoint: '', limit: 1 })
            .set(authHeader(owner.token))
        const second = await request(app)
            .get('/api/v1/sync/pull')
            .query({ checkpoint: first.body.data.checkpoint, limit: 1 })
            .set(authHeader(owner.token))

        const firstId = first.body.data.changes[0]?.doc._id
        const secondId = second.body.data.changes[0]?.doc._id
        expect(firstId).not.toBe(secondId)
    })

    it('includes tombstones for soft-deleted docs since the checkpoint', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const transaction = await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 100,
            currency: 'USD',
            title: 'To delete',
            date: new Date(),
        })

        const bootstrap = await request(app).get('/api/v1/sync/bootstrap').set(authHeader(owner.token))
        await request(app)
            .delete(`/api/v1/transactions/${transaction._id.toString()}`)
            .set(authHeader(owner.token))

        const pull = await request(app)
            .get('/api/v1/sync/pull')
            .query({ checkpoint: bootstrap.body.data.checkpoint })
            .set(authHeader(owner.token))

        expect(pull.status).toBe(200)
        const tombstone = pull.body.data.tombstones.find(
            (t: { _id: string }) => t._id === transaction._id.toString()
        )
        expect(tombstone).toBeDefined()
        expect(tombstone.entity).toBe('transaction')
        expect(typeof tombstone.deletedAt).toBe('string')
    })
})

describe('Sync API — push ordered apply', () => {
    let app: Application
    let owner: RegisteredUser

    beforeEach(async () => {
        app = createApp()
        owner = await registerUser(app)
    })

    it('applies a transaction.create op the same way the regular create endpoint does', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'op-1',
                        entity: 'transaction',
                        operation: 'create',
                        payload: {
                            type: 'expense',
                            title: 'Sync created expense',
                            amount: 500,
                            date: new Date().toISOString(),
                            accountId: account._id.toString(),
                            categoryId: category._id.toString(),
                        },
                    },
                ],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.results[0].status).toBe('applied')
        expect(typeof res.body.data.results[0].resultId).toBe('string')

        const stored = await Transaction.findById(res.body.data.results[0].resultId)
        expect(stored?.amount).toBe(500)

        const updatedAccount = await Account.findById(account._id)
        expect(updatedAccount?.currentBalance).toBe(-5)
    })

    it('persists externalId on a transaction.create op and round-trips it through pull (BUG-21)', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)

        const push = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'op-ext-1',
                        entity: 'transaction',
                        operation: 'create',
                        payload: {
                            type: 'expense',
                            title: 'Imported from OFX',
                            amount: 500,
                            date: new Date().toISOString(),
                            accountId: account._id.toString(),
                            categoryId: category._id.toString(),
                            externalId: 'FIT-XYZ-1',
                        },
                    },
                ],
            })
        expect(push.body.data.results[0].status).toBe('applied')

        const stored = await Transaction.findById(push.body.data.results[0].resultId)
        expect(stored?.externalId).toBe('FIT-XYZ-1')

        const pull = await request(app).get('/api/v1/sync/pull').set(authHeader(owner.token))
        const change = pull.body.data.changes.find(
            (c: { entity: string; doc: { _id: string } }) =>
                c.entity === 'transaction' && c.doc._id === stored?._id.toString()
        )
        expect(change.doc.externalId).toBe('FIT-XYZ-1')
    })

    it('applies ops in array order, not arrival order', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'create-1',
                        entity: 'transaction',
                        operation: 'create',
                        payload: {
                            type: 'expense',
                            title: 'First',
                            amount: 100,
                            date: new Date().toISOString(),
                            accountId: account._id.toString(),
                            categoryId: category._id.toString(),
                        },
                    },
                ],
            })
        const createdId = res.body.data.results[0].resultId

        const updateRes = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'update-1',
                        entity: 'transaction',
                        operation: 'update',
                        baseUpdatedAt: res.body.data.checkpoint,
                        payload: { _id: createdId, title: 'Renamed' },
                    },
                    {
                        opId: 'update-2',
                        entity: 'transaction',
                        operation: 'update',
                        payload: { _id: createdId, title: 'Renamed again' },
                    },
                ],
            })

        expect(updateRes.status).toBe(200)
        const stored = await Transaction.findById(createdId)
        expect(stored?.title).toBe('Renamed again')
    })

    it('applies a transaction.transfer intent atomically across both accounts', async () => {
        const from = await seedAccount(owner.userId, { name: 'From', currentBalance: 1000, openingBalance: 1000 })
        const to = await seedAccount(owner.userId, { name: 'To' })

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'transfer-1',
                        entity: 'transaction',
                        operation: 'create',
                        payload: {
                            intent: 'transaction.transfer',
                            amount: 4000,
                            date: new Date().toISOString(),
                            fromAccountId: from._id.toString(),
                            toAccountId: to._id.toString(),
                        },
                    },
                ],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.results[0].status).toBe('applied')

        const fromAfter = await Account.findById(from._id)
        const toAfter = await Account.findById(to._id)
        expect(fromAfter?.currentBalance).toBe(960)
        expect(toAfter?.currentBalance).toBe(40)
    })

    it('re-validates workspace role at op-apply time, not just at request time', async () => {
        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'no-membership-1',
                        entity: 'transaction',
                        operation: 'create',
                        payload: {
                            type: 'expense',
                            title: 'Should be rejected',
                            amount: 100,
                            date: new Date().toISOString(),
                            accountId: '64b64b64b64b64b64b64b64b',
                            categoryId: '64b64b64b64b64b64b64b64b',
                            workspaceId: '64b64b64b64b64b64b64b64b',
                        },
                    },
                ],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.results[0].status).toBe('rejected')
    })

    it('rejects push payloads over the configured size cap', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const ops = Array.from({ length: 5000 }, (_, i) => ({
            opId: `bulk-${i}`,
            entity: 'transaction',
            operation: 'create' as const,
            payload: {
                type: 'expense',
                title: `Bulk ${i}`,
                amount: 1,
                date: new Date().toISOString(),
                accountId: account._id.toString(),
                categoryId: category._id.toString(),
            },
        }))

        const res = await request(app).post('/api/v1/sync/push').set(authHeader(owner.token)).send({ ops })

        expect(res.status).toBe(413)
    })
})
