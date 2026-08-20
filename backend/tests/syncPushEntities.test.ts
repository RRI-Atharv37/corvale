import request from 'supertest'
import { Application } from 'express'
import { createApp } from '../app'
import Account from '../models/Account'
import Tag from '../models/Tag'
import TransactionTemplate from '../models/TransactionTemplate'
import Category from '../models/Category'
import Budget from '../models/Budget'
import SavingsGoal from '../models/SavingsGoal'
import RecurringRule from '../models/RecurringRule'
import CategorizationRule from '../models/CategorizationRule'
import { SOFT_DELETE_BYPASS } from '../utils/softDelete'
import { authHeader, registerUser, RegisteredUser } from './helpers'

/**
 * Sprint 13.9 acceptance spec for the generalized POST /sync/push dispatch
 * (syncController.ts's ENTITY_HANDLERS): every non-transaction syncable
 * entity now has working create/update/delete handling, not just
 * "Unsupported sync entity". This isn't exhaustive per-entity field
 * validation (that's covered by each entity's own REST-endpoint tests) —
 * it proves the generic dispatch mechanism is sound for both "delete"
 * semantics (archive-flag vs true soft-delete) using representative
 * entities: `account` (archive-flag), `tag` (soft-delete), and the new
 * `transactionTemplate` entity, plus a workspace-membership check.
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

describe('Sync API — push: account (archive-flag entity)', () => {
    let app: Application
    let owner: RegisteredUser

    beforeEach(async () => {
        app = createApp()
        owner = await registerUser(app)
    })

    it('creates an account via push, and a replay with the same client _id is a no-op', async () => {
        const clientId = '65a1b2c3d4e5f6a7b8c9d0e2'

        const first = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'account-create-1',
                        entity: 'account',
                        operation: 'create',
                        payload: {
                            _id: clientId,
                            name: 'Pushed Checking',
                            type: 'checking',
                            openingBalance: 100,
                        },
                    },
                ],
            })

        expect(first.status).toBe(200)
        expect(first.body.data.results[0].status).toBe('applied')
        expect(first.body.data.results[0].resultId).toBe(clientId)

        const replay = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'account-create-2',
                        entity: 'account',
                        operation: 'create',
                        payload: {
                            _id: clientId,
                            name: 'Different name, same id',
                            type: 'checking',
                            openingBalance: 999,
                        },
                    },
                ],
            })

        expect(replay.body.data.results[0].status).toBe('noop')
        expect(replay.body.data.results[0].resultId).toBe(clientId)

        const count = await Account.countDocuments({ userId: owner.userId, _id: clientId })
        expect(count).toBe(1)
        const stored = await Account.findById(clientId)
        expect(stored?.name).toBe('Pushed Checking')
    })

    it('updates an account via push, and a stale baseUpdatedAt is reported as a conflict', async () => {
        const account = await seedAccount(owner.userId, { name: 'Original' })
        const staleBaseUpdatedAt = account.updatedAt.toISOString()

        account.name = 'Changed out from under the client'
        await account.save()

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'account-update-1',
                        entity: 'account',
                        operation: 'update',
                        baseUpdatedAt: staleBaseUpdatedAt,
                        payload: { _id: account._id.toString(), name: 'Client wanted this name' },
                    },
                ],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.results[0].status).toBe('conflict')
        expect(res.body.data.results[0].conflict.serverDoc._id).toBe(account._id.toString())
        expect(res.body.data.results[0].conflict.serverDoc.name).toBe('Changed out from under the client')

        const stored = await Account.findById(account._id)
        expect(stored?.name).toBe('Changed out from under the client')
    })

    it('applies a non-stale update via push', async () => {
        const account = await seedAccount(owner.userId, { name: 'Original' })
        const baseUpdatedAt = account.updatedAt.toISOString()

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'account-update-2',
                        entity: 'account',
                        operation: 'update',
                        baseUpdatedAt,
                        payload: { _id: account._id.toString(), name: 'Renamed via sync' },
                    },
                ],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.results[0].status).toBe('applied')

        const stored = await Account.findById(account._id)
        expect(stored?.name).toBe('Renamed via sync')
    })

    it('translates a delete op into archiving, and a replay against an already-archived account is an idempotent no-op', async () => {
        const account = await seedAccount(owner.userId)

        const first = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'account-delete-1',
                        entity: 'account',
                        operation: 'delete',
                        payload: { _id: account._id.toString() },
                    },
                ],
            })

        expect(first.status).toBe(200)
        expect(first.body.data.results[0].status).toBe('applied')

        const stored = await Account.findById(account._id)
        expect(stored?.isArchived).toBe(true)

        // A second delete op (different opId — a genuine replay, not the
        // opId-level idempotency short-circuit) against the now-archived
        // account must resolve as a harmless no-op, not
        // ACCOUNT_ALREADY_ARCHIVED the way the REST archive endpoint would.
        const second = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'account-delete-2',
                        entity: 'account',
                        operation: 'delete',
                        payload: { _id: account._id.toString() },
                    },
                ],
            })

        expect(second.status).toBe(200)
        expect(second.body.data.results[0].status).toBe('noop')
        expect(second.body.data.results[0].resultId).toBe(account._id.toString())
    })
})

describe('Sync API — push: tag (soft-delete entity)', () => {
    let app: Application
    let owner: RegisteredUser

    beforeEach(async () => {
        app = createApp()
        owner = await registerUser(app)
    })

    it('creates a tag via push, and a replay with the same client _id is a no-op', async () => {
        const clientId = '65a1b2c3d4e5f6a7b8c9d0e3'

        const first = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'tag-create-1',
                        entity: 'tag',
                        operation: 'create',
                        payload: { _id: clientId, name: 'Groceries' },
                    },
                ],
            })

        expect(first.status).toBe(200)
        expect(first.body.data.results[0].status).toBe('applied')
        expect(first.body.data.results[0].resultId).toBe(clientId)

        const replay = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'tag-create-2',
                        entity: 'tag',
                        operation: 'create',
                        payload: { _id: clientId, name: 'Different name, same id' },
                    },
                ],
            })

        expect(replay.body.data.results[0].status).toBe('noop')
        expect(replay.body.data.results[0].resultId).toBe(clientId)

        const count = await Tag.countDocuments({ userId: owner.userId, _id: clientId })
        expect(count).toBe(1)
    })

    it('updates a tag via push, and a stale baseUpdatedAt is reported as a conflict', async () => {
        const tag = await Tag.create({ userId: owner.userId, name: 'Original Tag' })
        const staleBaseUpdatedAt = tag.updatedAt.toISOString()

        tag.name = 'Changed out from under the client'
        await tag.save()

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'tag-update-1',
                        entity: 'tag',
                        operation: 'update',
                        baseUpdatedAt: staleBaseUpdatedAt,
                        payload: { _id: tag._id.toString(), name: 'Client wanted this name' },
                    },
                ],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.results[0].status).toBe('conflict')
        expect(res.body.data.results[0].conflict.serverDoc.name).toBe('Changed out from under the client')
    })

    it('tombstones a tag unconditionally via a delete op', async () => {
        const tag = await Tag.create({ userId: owner.userId, name: 'To delete' })

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'tag-delete-1',
                        entity: 'tag',
                        operation: 'delete',
                        payload: { _id: tag._id.toString() },
                    },
                ],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.results[0].status).toBe('applied')

        const stored = await Tag.findOne({ _id: tag._id }).setOptions({ [SOFT_DELETE_BYPASS]: true })
        expect(stored?.deletedAt).toBeTruthy()
    })

    it('a second delete op with a different opId against an already-deleted tag is an idempotent no-op, not a 404', async () => {
        const tag = await Tag.create({ userId: owner.userId, name: 'Deleted twice' })

        const first = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [{ opId: 'tag-delete-a', entity: 'tag', operation: 'delete', payload: { _id: tag._id.toString() } }],
            })
        expect(first.body.data.results[0].status).toBe('applied')

        const second = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [{ opId: 'tag-delete-b', entity: 'tag', operation: 'delete', payload: { _id: tag._id.toString() } }],
            })

        expect(second.status).toBe(200)
        expect(second.body.data.results[0].status).toBe('noop')
        expect(second.body.data.results[0].resultId).toBe(tag._id.toString())
    })
})

describe('Sync API — push: transactionTemplate (new entity)', () => {
    let app: Application
    let owner: RegisteredUser

    beforeEach(async () => {
        app = createApp()
        owner = await registerUser(app)
    })

    it('creates a transaction template via push, and a replay with the same client _id is a no-op', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const clientId = '65a1b2c3d4e5f6a7b8c9d0e4'

        const first = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'template-create-1',
                        entity: 'transactionTemplate',
                        operation: 'create',
                        payload: {
                            _id: clientId,
                            name: 'Coffee run',
                            type: 'expense',
                            amount: 450,
                            accountId: account._id.toString(),
                            categoryId: category._id.toString(),
                        },
                    },
                ],
            })

        expect(first.status).toBe(200)
        expect(first.body.data.results[0].status).toBe('applied')
        expect(first.body.data.results[0].resultId).toBe(clientId)

        const replay = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'template-create-2',
                        entity: 'transactionTemplate',
                        operation: 'create',
                        payload: {
                            _id: clientId,
                            name: 'Different name, same id',
                            type: 'expense',
                            amount: 999,
                            accountId: account._id.toString(),
                            categoryId: category._id.toString(),
                        },
                    },
                ],
            })

        expect(replay.body.data.results[0].status).toBe('noop')
        expect(replay.body.data.results[0].resultId).toBe(clientId)

        const count = await TransactionTemplate.countDocuments({ userId: owner.userId, _id: clientId })
        expect(count).toBe(1)

        const stored = await TransactionTemplate.findById(clientId)
        expect(stored?.amount).toBe(450)
    })

    it('stores a minor-units amount from the sync payload as-is, not re-converted as a major-unit decimal', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'template-amount-1',
                        entity: 'transactionTemplate',
                        operation: 'create',
                        payload: {
                            name: 'Amount check',
                            type: 'expense',
                            amount: 4599,
                            accountId: account._id.toString(),
                            categoryId: category._id.toString(),
                        },
                    },
                ],
            })

        expect(res.status).toBe(200)
        const stored = await TransactionTemplate.findById(res.body.data.results[0].resultId)
        expect(stored?.amount).toBe(4599)
    })

    it('updates a transaction template via push, and a stale baseUpdatedAt is reported as a conflict', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const template = await TransactionTemplate.create({
            userId: owner.userId,
            name: 'Original template',
            type: 'expense',
            amount: 500,
            accountId: account._id,
            categoryId: category._id,
        })
        const staleBaseUpdatedAt = template.updatedAt.toISOString()

        template.name = 'Changed out from under the client'
        await template.save()

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'template-update-1',
                        entity: 'transactionTemplate',
                        operation: 'update',
                        baseUpdatedAt: staleBaseUpdatedAt,
                        payload: { _id: template._id.toString(), name: 'Client wanted this name' },
                    },
                ],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.results[0].status).toBe('conflict')
        expect(res.body.data.results[0].conflict.serverDoc.name).toBe('Changed out from under the client')
    })

    it('tombstones a transaction template unconditionally via a delete op', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const template = await TransactionTemplate.create({
            userId: owner.userId,
            name: 'To delete',
            type: 'expense',
            amount: 500,
            accountId: account._id,
            categoryId: category._id,
        })

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'template-delete-1',
                        entity: 'transactionTemplate',
                        operation: 'delete',
                        payload: { _id: template._id.toString() },
                    },
                ],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.results[0].status).toBe('applied')

        const stored = await TransactionTemplate.findOne({ _id: template._id }).setOptions({
            [SOFT_DELETE_BYPASS]: true,
        })
        expect(stored?.deletedAt).toBeTruthy()
    })
})

describe('Sync API — push: workspace membership is re-validated at op-apply time', () => {
    let app: Application
    let owner: RegisteredUser
    let outsider: RegisteredUser
    let workspaceId: string

    beforeEach(async () => {
        app = createApp()
        owner = await registerUser(app)
        outsider = await registerUser(app, { email: 'sync-push-outsider@example.com' })

        const workspaceRes = await request(app)
            .post('/api/v1/workspaces')
            .set(authHeader(owner.token))
            .send({ name: 'Shared Finances' })
        workspaceId = workspaceRes.body.data._id
    })

    it('rejects a budget create op targeting a workspace the caller is not a member of', async () => {
        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(outsider.token))
            .send({
                ops: [
                    {
                        opId: 'budget-create-no-membership',
                        entity: 'budget',
                        operation: 'create',
                        payload: {
                            periodType: 'monthly',
                            year: 2026,
                            month: 1,
                            amount: 100,
                            workspaceId,
                        },
                    },
                ],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.results[0].status).toBe('rejected')
    })

    it('applies a budget create op for a workspace the caller is a member of', async () => {
        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'budget-create-with-membership',
                        entity: 'budget',
                        operation: 'create',
                        payload: {
                            periodType: 'monthly',
                            year: 2026,
                            month: 1,
                            amount: 100,
                            workspaceId,
                        },
                    },
                ],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.results[0].status).toBe('applied')
    })

    it('stores a budget amount from the sync payload in minor units as-is, not re-converted as a major-unit decimal', async () => {
        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'budget-amount-1',
                        entity: 'budget',
                        operation: 'create',
                        payload: {
                            periodType: 'monthly',
                            year: 2026,
                            month: 1,
                            amount: 45000,
                            workspaceId,
                        },
                    },
                ],
            })

        expect(res.status).toBe(200)
        const stored = await Budget.findById(res.body.data.results[0].resultId)
        expect(stored?.amount).toBe(45000)
    })

    it('stores a savings goal targetAmount and a recurring rule amount from the sync payload in minor units as-is', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)

        const goalRes = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'goal-amount-1',
                        entity: 'savingsGoal',
                        operation: 'create',
                        payload: { name: 'Emergency fund', targetAmount: 500000 },
                    },
                ],
            })
        expect(goalRes.status).toBe(200)
        const storedGoal = await SavingsGoal.findById(goalRes.body.data.results[0].resultId)
        expect(storedGoal?.targetAmount).toBe(500000)

        const ruleRes = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'rule-amount-1',
                        entity: 'recurringRule',
                        operation: 'create',
                        payload: {
                            title: 'Rent',
                            type: 'expense',
                            amount: 150000,
                            accountId: account._id.toString(),
                            categoryId: category._id.toString(),
                            interval: 'monthly',
                            nextDueDate: '2026-02-01',
                        },
                    },
                ],
            })
        expect(ruleRes.status).toBe(200)
        const storedRule = await RecurringRule.findById(ruleRes.body.data.results[0].resultId)
        expect(storedRule?.amount).toBe(150000)

        const catRuleRes = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'catrule-amount-1',
                        entity: 'categorizationRule',
                        operation: 'create',
                        payload: {
                            name: 'Big purchases',
                            matchType: 'amount_range',
                            amountMin: 10000,
                            amountMax: 100000,
                            categoryId: category._id.toString(),
                        },
                    },
                ],
            })
        expect(catRuleRes.status).toBe(200)
        const storedCatRule = await CategorizationRule.findById(catRuleRes.body.data.results[0].resultId)
        expect(storedCatRule?.amountMin).toBe(10000)
        expect(storedCatRule?.amountMax).toBe(100000)
    })
})
