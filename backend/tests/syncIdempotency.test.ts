import request from 'supertest'
import { Application } from 'express'
import { createApp } from '@http/app'
import { Account } from '@modules/accounts'
import { Category } from '@modules/categories'
import { Transaction } from '@modules/transactions'
import { registerUser, authHeader, RegisteredUser } from './helpers'

/**
 * Sprint 13.0 acceptance spec for `SyncOperation` idempotency (Sprint 13.2:
 * `SyncOperation` model, unique on `(userId, opId)`).
 *
 * Contract: replaying a `POST /api/v1/sync/push` op with an `opId` the
 * server has already recorded for this user returns the SAME stored
 * `{ status, resultId }` without re-running the op's side effects (no
 * double-created document, no double-applied balance delta). This must
 * hold even when the replay arrives in a different HTTP request (the
 * classic "client retried after a timed-out response" scenario) and even
 * when it's bundled inside a push batch alongside brand-new ops.
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

describe('Sync API — opId idempotency', () => {
    let app: Application
    let owner: RegisteredUser

    beforeEach(async () => {
        app = createApp()
        owner = await registerUser(app)
    })

    it('replaying an identical create op returns the same resultId and does not create a second document', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const op = {
            opId: 'retry-create-1',
            entity: 'transaction',
            operation: 'create' as const,
            payload: {
                type: 'expense',
                title: 'Groceries',
                amount: 2500,
                date: new Date().toISOString(),
                accountId: account._id.toString(),
                categoryId: category._id.toString(),
            },
        }

        const first = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({ ops: [op] })
        const replay = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({ ops: [op] })

        expect(first.body.data.results[0].status).toBe('applied')
        expect(replay.body.data.results[0].status).toBe('applied')
        expect(replay.body.data.results[0].resultId).toBe(first.body.data.results[0].resultId)

        const count = await Transaction.countDocuments({ userId: owner.userId })
        expect(count).toBe(1)
    })

    it('does not double-apply the account balance delta on replay', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const op = {
            opId: 'retry-create-2',
            entity: 'transaction',
            operation: 'create' as const,
            payload: {
                type: 'expense',
                title: 'Rent',
                amount: 100000,
                date: new Date().toISOString(),
                accountId: account._id.toString(),
                categoryId: category._id.toString(),
            },
        }

        await request(app).post('/api/v1/sync/push').set(authHeader(owner.token)).send({ ops: [op] })
        await request(app).post('/api/v1/sync/push').set(authHeader(owner.token)).send({ ops: [op] })
        await request(app).post('/api/v1/sync/push').set(authHeader(owner.token)).send({ ops: [op] })

        const updatedAccount = await Account.findById(account._id)
        expect(updatedAccount?.currentBalance).toBe(0)
    })

    it('does not double-apply a delete on replay', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const transaction = await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 500,
            currency: 'USD',
            title: 'To delete',
            date: new Date(),
        })

        const op = {
            opId: 'retry-delete-1',
            entity: 'transaction',
            operation: 'delete' as const,
            payload: { _id: transaction._id.toString() },
        }

        const first = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({ ops: [op] })
        const replay = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({ ops: [op] })

        expect(first.body.data.results[0].status).toBe('applied')
        expect(replay.body.data.results[0].status).toBe('applied')

        const updatedAccount = await Account.findById(account._id)
        expect(updatedAccount?.currentBalance).toBe(1000)
    })

    it('records a fresh SyncOperation per distinct opId even when payloads are identical', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const payload = {
            type: 'expense' as const,
            title: 'Coffee',
            amount: 400,
            date: new Date().toISOString(),
            accountId: account._id.toString(),
            categoryId: category._id.toString(),
        }

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    { opId: 'distinct-1', entity: 'transaction', operation: 'create', payload },
                    { opId: 'distinct-2', entity: 'transaction', operation: 'create', payload },
                ],
            })

        expect(res.body.data.results[0].resultId).not.toBe(res.body.data.results[1].resultId)
        const count = await Transaction.countDocuments({ userId: owner.userId })
        expect(count).toBe(2)
    })

    it('scopes opId uniqueness per-user — two users may reuse the same opId independently', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const other = await registerUser(app, { email: 'idempotency-other@example.com' })
        const otherAccount = await seedAccount(other.userId)
        const otherCategory = await seedCategory(other.userId)

        const sharedOpId = 'shared-across-users'

        const ownerRes = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: sharedOpId,
                        entity: 'transaction',
                        operation: 'create',
                        payload: {
                            type: 'expense',
                            title: 'Owner tx',
                            amount: 100,
                            date: new Date().toISOString(),
                            accountId: account._id.toString(),
                            categoryId: category._id.toString(),
                        },
                    },
                ],
            })
        const otherRes = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(other.token))
            .send({
                ops: [
                    {
                        opId: sharedOpId,
                        entity: 'transaction',
                        operation: 'create',
                        payload: {
                            type: 'expense',
                            title: 'Other tx',
                            amount: 200,
                            date: new Date().toISOString(),
                            accountId: otherAccount._id.toString(),
                            categoryId: otherCategory._id.toString(),
                        },
                    },
                ],
            })

        expect(ownerRes.body.data.results[0].status).toBe('applied')
        expect(otherRes.body.data.results[0].status).toBe('applied')
        expect(ownerRes.body.data.results[0].resultId).not.toBe(otherRes.body.data.results[0].resultId)
    })
})
