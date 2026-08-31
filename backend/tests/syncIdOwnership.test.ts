import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { Application } from 'express'
import { createApp } from '../app'
import Account from '../models/Account'
import Category from '../models/Category'
import Tag from '../models/Tag'
import Transaction from '../models/Transaction'
import { registerUser, authHeader, RegisteredUser } from './helpers'

/**
 * Acceptance spec for sync id-ownership (C2, SEC-13, BUG-02, BUG-09, BUG-10).
 *
 * Three independent gaps in `syncController.ts`'s create-op handling:
 *
 *   1. `applyCreateOp`/`applyGenericCreate` treat "a document with this
 *      client-generated `_id` already exists" as an idempotent no-op of the
 *      CALLER's own create, without checking who owns the existing
 *      document. A cross-user id collision silently discards the caller's
 *      data and hands back a `resultId` pointing at a stranger's document
 *      (SEC-13, BUG-02). The fix must add an ownership check after
 *      `findById` and return a new `id_conflict` status (not `noop`, and
 *      with `resultId: null`) when the existing document belongs to
 *      someone else — for both the transaction-specific path and the
 *      generic per-entity path.
 *   2. `pushSyncOps` hardcodes `computeCurrentCheckpoint(userId, null)` — a
 *      personal-scope checkpoint — even when the pushed ops (and the
 *      client's sync cursor) are workspace-scoped (BUG-09). The fix reads
 *      `workspaceId` from the push request body (mirroring how bootstrap/
 *      pull already read it from the query string), asserts membership,
 *      and computes the checkpoint over that same scope.
 *   3. Applying an op and recording its `SyncOperation` ledger row are two
 *      separate, non-transactional awaits (BUG-10). Whatever the fix
 *      (Mongo transaction, or ledger-row-first-then-apply), the outward
 *      guarantee is exactly-once application even when two requests race
 *      on the same `opId` concurrently — not just on sequential retries
 *      (already covered by syncIdempotency.test.ts).
 */

const seedAccount = async (userId: string, overrides: Partial<Record<string, unknown>> = {}) =>
    Account.create({
        userId,
        name: 'Checking',
        type: 'checking',
        currency: 'USD',
        openingBalance: 1000,
        currentBalance: 1000,
        ...overrides,
    })

const seedCategory = async (userId: string, name = 'Groceries') => Category.create({ userId, name })

describe('Sync create — cross-tenant id ownership (SEC-13, BUG-02)', () => {
    let app: Application

    it('rejects a transaction create colliding with another user\'s id as id_conflict, not noop', async () => {
        app = createApp()
        const owner: RegisteredUser = await registerUser(app, { email: 'sync-owner-a@example.com' })
        const attacker: RegisteredUser = await registerUser(app, { email: 'sync-attacker-a@example.com' })

        const ownerAccount = await seedAccount(owner.userId)
        const ownerCategory = await seedCategory(owner.userId)
        const ownerTxn = await Transaction.create({
            userId: owner.userId,
            accountId: ownerAccount._id,
            categoryId: ownerCategory._id,
            type: 'expense',
            amount: 4200,
            currency: 'USD',
            title: 'Owner private expense',
            date: new Date(),
        })

        const attackerAccount = await seedAccount(attacker.userId)
        const attackerCategory = await seedCategory(attacker.userId)

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(attacker.token))
            .send({
                ops: [
                    {
                        opId: 'attacker-collide-1',
                        entity: 'transaction',
                        operation: 'create',
                        payload: {
                            _id: ownerTxn._id.toString(),
                            type: 'expense',
                            title: 'Attacker payload',
                            amount: 100,
                            date: new Date().toISOString(),
                            accountId: attackerAccount._id.toString(),
                            categoryId: attackerCategory._id.toString(),
                        },
                    },
                ],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.results[0].status).toBe('id_conflict')
        expect(res.body.data.results[0].resultId).toBeNull()

        const stillOwners = await Transaction.findById(ownerTxn._id)
        expect(stillOwners?.title).toBe('Owner private expense')
        expect(stillOwners?.userId.toString()).toBe(owner.userId)
    })

    it('rejects a generic-entity (account) create colliding with another user\'s id as id_conflict', async () => {
        app = createApp()
        const owner: RegisteredUser = await registerUser(app, { email: 'sync-owner-b@example.com' })
        const attacker: RegisteredUser = await registerUser(app, { email: 'sync-attacker-b@example.com' })

        const ownerAccount = await seedAccount(owner.userId, { name: 'Owner Savings' })

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(attacker.token))
            .send({
                ops: [
                    {
                        opId: 'attacker-collide-account-1',
                        entity: 'account',
                        operation: 'create',
                        payload: {
                            _id: ownerAccount._id.toString(),
                            name: 'Attacker Account',
                            type: 'cash',
                        },
                    },
                ],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.results[0].status).toBe('id_conflict')

        const stillOwners = await Account.findById(ownerAccount._id)
        expect(stillOwners?.name).toBe('Owner Savings')
        expect(stillOwners?.userId.toString()).toBe(owner.userId)
    })

    it('SEC-55: a create colliding with another user\'s TOMBSTONED id is id_conflict, not a slip-through', async () => {
        app = createApp()
        const owner: RegisteredUser = await registerUser(app, { email: 'sync-owner-tomb-a@example.com' })
        const attacker: RegisteredUser = await registerUser(app, { email: 'sync-attacker-tomb-a@example.com' })

        const ownerAccount = await seedAccount(owner.userId)
        const ownerCategory = await seedCategory(owner.userId)
        const ownerTxn = await Transaction.create({
            userId: owner.userId,
            accountId: ownerAccount._id,
            categoryId: ownerCategory._id,
            type: 'expense',
            amount: 4200,
            currency: 'USD',
            title: 'Owner private expense',
            date: new Date(),
        })
        // Soft-delete it — the row stays in the collection with deletedAt set.
        await request(app)
            .delete(`/api/v1/transactions/${ownerTxn._id.toString()}`)
            .set(authHeader(owner.token))

        const attackerAccount = await seedAccount(attacker.userId)
        const attackerCategory = await seedCategory(attacker.userId)

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(attacker.token))
            .send({
                ops: [
                    {
                        opId: 'attacker-tomb-collide-1',
                        entity: 'transaction',
                        operation: 'create',
                        payload: {
                            _id: ownerTxn._id.toString(),
                            type: 'expense',
                            title: 'Attacker payload',
                            amount: 100,
                            date: new Date().toISOString(),
                            accountId: attackerAccount._id.toString(),
                            categoryId: attackerCategory._id.toString(),
                        },
                    },
                ],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.results[0].status).toBe('id_conflict')
        expect(res.body.data.results[0].resultId).toBeNull()
    })

    it('SEC-55: the generic-entity path also catches a tombstoned-id collision (Tag)', async () => {
        app = createApp()
        const owner: RegisteredUser = await registerUser(app, { email: 'sync-owner-tomb-tag@example.com' })
        const attacker: RegisteredUser = await registerUser(app, { email: 'sync-attacker-tomb-tag@example.com' })

        const ownerTag = await Tag.create({ userId: owner.userId, name: 'private-tag' })
        await request(app).delete(`/api/v1/tags/${ownerTag._id.toString()}`).set(authHeader(owner.token))

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(attacker.token))
            .send({
                ops: [
                    {
                        opId: 'attacker-tag-tomb-1',
                        entity: 'tag',
                        operation: 'create',
                        payload: { _id: ownerTag._id.toString(), name: 'attacker-tag' },
                    },
                ],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.results[0].status).toBe('id_conflict')
    })

    it('SEC-55: a create colliding with the caller\'s OWN tombstoned id is id_conflict (cannot bind to a tombstone)', async () => {
        app = createApp()
        const owner: RegisteredUser = await registerUser(app, { email: 'sync-owner-tomb-b@example.com' })
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)

        const first = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'own-tomb-create-1',
                        entity: 'transaction',
                        operation: 'create',
                        payload: {
                            type: 'expense',
                            title: 'Will be deleted',
                            amount: 500,
                            date: new Date().toISOString(),
                            accountId: account._id.toString(),
                            categoryId: category._id.toString(),
                        },
                    },
                ],
            })
        const createdId = first.body.data.results[0].resultId
        await request(app)
            .delete(`/api/v1/transactions/${createdId}`)
            .set(authHeader(owner.token))

        const recreate = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'own-tomb-recreate-1',
                        entity: 'transaction',
                        operation: 'create',
                        payload: {
                            _id: createdId,
                            type: 'expense',
                            title: 'Recreate on a dead id',
                            amount: 500,
                            date: new Date().toISOString(),
                            accountId: account._id.toString(),
                            categoryId: category._id.toString(),
                        },
                    },
                ],
            })

        expect(recreate.body.data.results[0].status).toBe('id_conflict')
        expect(recreate.body.data.results[0].resultId).toBeNull()
    })

    it('a real accidental idempotent replay by the SAME user is still a noop, not a conflict', async () => {
        app = createApp()
        const owner: RegisteredUser = await registerUser(app, { email: 'sync-owner-c@example.com' })
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)

        const op = {
            opId: 'owner-replay-1',
            entity: 'transaction' as const,
            operation: 'create' as const,
            payload: {
                type: 'expense',
                title: 'Same-user replay',
                amount: 500,
                date: new Date().toISOString(),
                accountId: account._id.toString(),
                categoryId: category._id.toString(),
            },
        }

        const first = await request(app).post('/api/v1/sync/push').set(authHeader(owner.token)).send({ ops: [op] })
        const createdId = first.body.data.results[0].resultId

        // Same user, same client-generated _id this time (simulating an
        // offline retry that regenerated the create with its own known id).
        const replay = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'owner-replay-2',
                        entity: 'transaction',
                        operation: 'create',
                        payload: { ...op.payload, _id: createdId },
                    },
                ],
            })

        expect(replay.body.data.results[0].status).toBe('noop')
        expect(replay.body.data.results[0].resultId).toBe(createdId)
    })
})

describe('Sync push — workspace-scoped checkpoint (BUG-09)', () => {
    it('returns a checkpoint computed over the workspace scope, not the personal scope', async () => {
        const app = createApp()
        const owner: RegisteredUser = await registerUser(app, { email: 'sync-checkpoint-owner@example.com' })

        // Personal-scope data that must NOT influence the workspace checkpoint.
        const personalAccount = await seedAccount(owner.userId, { name: 'Personal' })
        const personalCategory = await seedCategory(owner.userId, 'Personal Category')
        await Transaction.create({
            userId: owner.userId,
            accountId: personalAccount._id,
            categoryId: personalCategory._id,
            type: 'expense',
            amount: 100,
            currency: 'USD',
            title: 'Personal expense',
            date: new Date(),
        })

        const workspaceRes = await request(app)
            .post('/api/v1/workspaces')
            .set(authHeader(owner.token))
            .send({ name: 'Checkpoint Workspace' })
        const workspaceId = workspaceRes.body.data._id

        const pushRes = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                workspaceId,
                ops: [
                    {
                        opId: 'workspace-account-create-1',
                        entity: 'account',
                        operation: 'create',
                        payload: { name: 'Team Checking', type: 'checking', workspaceId },
                    },
                ],
            })

        expect(pushRes.status).toBe(200)
        expect(pushRes.body.data.results[0].status).toBe('applied')

        const bootstrapRes = await request(app)
            .get('/api/v1/sync/bootstrap')
            .query({ workspaceId })
            .set(authHeader(owner.token))

        // Nothing else touched this workspace between the push and this
        // bootstrap call, so a workspace-scoped checkpoint must match
        // exactly. A personal-scope checkpoint (today's bug) would not,
        // because the personal scope has a transaction the workspace scope
        // does not.
        expect(pushRes.body.data.checkpoint).toBe(bootstrapRes.body.data.checkpoint)

        const personalBootstrap = await request(app)
            .get('/api/v1/sync/bootstrap')
            .set(authHeader(owner.token))
        expect(pushRes.body.data.checkpoint).not.toBe(personalBootstrap.body.data.checkpoint)
    })
})

describe('Sync push — exactly-once application under concurrent retry (BUG-10)', () => {
    it('applies a balance-affecting create exactly once when two requests race on the same opId', async () => {
        const app = createApp()
        const owner: RegisteredUser = await registerUser(app, { email: 'sync-race@example.com' })
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)

        const op = {
            opId: 'race-create-1',
            entity: 'transaction' as const,
            operation: 'create' as const,
            payload: {
                type: 'expense' as const,
                title: 'Race condition rent',
                amount: 40000,
                date: new Date().toISOString(),
                accountId: account._id.toString(),
                categoryId: category._id.toString(),
            },
        }

        const [first, second] = await Promise.all([
            request(app).post('/api/v1/sync/push').set(authHeader(owner.token)).send({ ops: [op] }),
            request(app).post('/api/v1/sync/push').set(authHeader(owner.token)).send({ ops: [op] }),
        ])

        expect([first.body.data.results[0].status, second.body.data.results[0].status]).toContain('applied')

        const count = await Transaction.countDocuments({ userId: owner.userId })
        expect(count).toBe(1)

        const updatedAccount = await Account.findById(account._id)
        expect(updatedAccount?.currentBalance).toBe(600)
    })
})
