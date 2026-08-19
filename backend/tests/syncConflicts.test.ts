import request from 'supertest'
import { Application } from 'express'
import { createApp } from '../app'
import Account from '../models/Account'
import Category from '../models/Category'
import Transaction from '../models/Transaction'
import { SOFT_DELETE_BYPASS } from '../utils/softDelete'
import { registerUser, authHeader, RegisteredUser } from './helpers'

/**
 * Sprint 13.0 acceptance spec for sync conflict detection (Sprint 13.3).
 * Contract (see ROADMAP.md "Conflicts" row):
 *   - Per-document last-write-wins with the SERVER as arbiter.
 *   - An `update`/`delete` op carries `baseUpdatedAt`; if it doesn't match
 *     the server doc's current `updatedAt`, the op comes back
 *     `status: 'conflict'` with `conflict.serverDoc` set to the current
 *     server state, and the client's mutation is NOT applied.
 *   - Money fields are never field-merged — a conflict is surfaced, not
 *     auto-resolved.
 *   - delete-vs-update: whichever ordering the ops arrive in, the delete
 *     always wins — the document ends up deleted (soft-deleted) and any
 *     update that raced against it is reported as a conflict.
 *   - A duplicate `create` (payload carries a client-generated `_id` that
 *     already exists for this entity/user) is a no-op: the existing
 *     document is left untouched and the op is reported without creating a
 *     second document.
 */

const seedAccount = async (userId: string) =>
    Account.create({
        userId,
        name: 'Checking',
        type: 'checking',
        currency: 'USD',
        openingBalance: 1000,
        currentBalance: 1000,
    })

const seedCategory = async (userId: string, name = 'Groceries') => Category.create({ userId, name })

describe('Sync API — conflict resolution', () => {
    let app: Application
    let owner: RegisteredUser

    beforeEach(async () => {
        app = createApp()
        owner = await registerUser(app)
    })

    it('a stale baseUpdatedAt on update is reported as a conflict and does not mutate the doc', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const transaction = await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 100,
            currency: 'USD',
            title: 'Original title',
            date: new Date(),
        })
        const staleBaseUpdatedAt = transaction.updatedAt.toISOString()

        transaction.title = 'Changed out from under the client'
        await transaction.save()

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'stale-update-1',
                        entity: 'transaction',
                        operation: 'update',
                        baseUpdatedAt: staleBaseUpdatedAt,
                        payload: { _id: transaction._id.toString(), title: 'Client wanted this title' },
                    },
                ],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.results[0].status).toBe('conflict')
        expect(res.body.data.results[0].conflict.serverDoc._id).toBe(transaction._id.toString())
        expect(res.body.data.results[0].conflict.serverDoc.title).toBe('Changed out from under the client')

        const stored = await Transaction.findById(transaction._id)
        expect(stored?.title).toBe('Changed out from under the client')
    })

    it('never field-merges a money field on conflict — the server amount is untouched', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const transaction = await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 100,
            currency: 'USD',
            title: 'Amount conflict',
            date: new Date(),
        })
        const staleBaseUpdatedAt = transaction.updatedAt.toISOString()
        transaction.amount = 9999
        await transaction.save()

        await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'stale-amount-1',
                        entity: 'transaction',
                        operation: 'update',
                        baseUpdatedAt: staleBaseUpdatedAt,
                        payload: { _id: transaction._id.toString(), amount: 100 },
                    },
                ],
            })

        const stored = await Transaction.findById(transaction._id)
        expect(stored?.amount).toBe(9999)
    })

    it('delete wins over a racing update issued in the same push, update-then-delete order', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const transaction = await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 100,
            currency: 'USD',
            title: 'Delete vs update',
            date: new Date(),
        })
        const baseUpdatedAt = transaction.updatedAt.toISOString()

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'race-update',
                        entity: 'transaction',
                        operation: 'update',
                        baseUpdatedAt,
                        payload: { _id: transaction._id.toString(), title: 'Racing update' },
                    },
                    {
                        opId: 'race-delete',
                        entity: 'transaction',
                        operation: 'delete',
                        baseUpdatedAt,
                        payload: { _id: transaction._id.toString() },
                    },
                ],
            })

        expect(res.body.data.results[1].status).toBe('applied')

        const stored = await Transaction.findOne({ _id: transaction._id }).setOptions({
            [SOFT_DELETE_BYPASS]: true,
        })
        expect(stored?.deletedAt).toBeTruthy()
    })

    it('delete wins over a racing update issued delete-then-update, across two push calls', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const transaction = await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 100,
            currency: 'USD',
            title: 'Delete first',
            date: new Date(),
        })
        const baseUpdatedAt = transaction.updatedAt.toISOString()

        await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'delete-first',
                        entity: 'transaction',
                        operation: 'delete',
                        baseUpdatedAt,
                        payload: { _id: transaction._id.toString() },
                    },
                ],
            })

        const updateRes = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'update-after-delete',
                        entity: 'transaction',
                        operation: 'update',
                        baseUpdatedAt,
                        payload: { _id: transaction._id.toString(), title: 'Too late' },
                    },
                ],
            })

        expect(updateRes.body.data.results[0].status).toBe('conflict')

        const stored = await Transaction.findOne({ _id: transaction._id }).setOptions({
            [SOFT_DELETE_BYPASS]: true,
        })
        expect(stored?.deletedAt).toBeTruthy()
        expect(stored?.title).toBe('Delete first')
    })

    it('a duplicate create with an already-used client-generated _id is a no-op, not a second document', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const clientId = '65a1b2c3d4e5f6a7b8c9d0e1'

        const first = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'dup-create-1',
                        entity: 'transaction',
                        operation: 'create',
                        payload: {
                            _id: clientId,
                            type: 'expense',
                            title: 'First device',
                            amount: 100,
                            date: new Date().toISOString(),
                            accountId: account._id.toString(),
                            categoryId: category._id.toString(),
                        },
                    },
                ],
            })

        const duplicate = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'dup-create-2',
                        entity: 'transaction',
                        operation: 'create',
                        payload: {
                            _id: clientId,
                            type: 'expense',
                            title: 'Second device, same _id',
                            amount: 999,
                            date: new Date().toISOString(),
                            accountId: account._id.toString(),
                            categoryId: category._id.toString(),
                        },
                    },
                ],
            })

        expect(first.body.data.results[0].status).toBe('applied')
        expect(duplicate.body.data.results[0].status).toBe('noop')
        expect(duplicate.body.data.results[0].resultId).toBe(clientId)

        const count = await Transaction.countDocuments({ userId: owner.userId, _id: clientId })
        expect(count).toBe(1)
        const stored = await Transaction.findById(clientId)
        expect(stored?.title).toBe('First device')
    })
})
