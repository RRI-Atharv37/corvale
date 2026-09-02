import request from 'supertest'
import { Application } from 'express'
import { Types } from 'mongoose'
import { createApp } from '@http/app'
import { Account } from '@modules/accounts'
import { Category } from '@modules/categories'
import { Transaction } from '@modules/transactions'
import { Tag } from '@modules/tags'
import { Budget } from '@modules/budgets'
import { SavingsGoal } from '@modules/savings-goals'
import { registerUser, authHeader, RegisteredUser } from './helpers'

/**
 * Acceptance spec for client-generated `_id` acceptance on every create endpoint.
 * Contract (the "Identity" architecture decision): the client may generate its own
 * 24-hex ObjectId offline and the
 * server must accept it verbatim on create, so the record is
 * creatable/referenceable before the server has ever seen it (no
 * backup-restore-style FK remapping needed once sync lands). An `_id`
 * that's a syntactically invalid ObjectId, or one already in use by
 * another of the user's documents, must be rejected rather than silently
 * regenerated. Omitting `_id` must preserve today's behavior exactly
 * (server generates one, as it does now).
 */

const freshId = () => new Types.ObjectId().toString()

describe('Client-generated _id acceptance', () => {
    let app: Application
    let owner: RegisteredUser
    let accountId: string
    let categoryId: string

    beforeEach(async () => {
        app = createApp()
        owner = await registerUser(app)
        const account = await Account.create({
            userId: owner.userId,
            name: 'Checking',
            type: 'checking',
            currency: 'USD',
            openingBalance: 0,
            currentBalance: 0,
        })
        const category = await Category.create({ userId: owner.userId, name: 'Groceries' })
        accountId = account._id.toString()
        categoryId = category._id.toString()
    })

    describe('POST /api/v1/transactions', () => {
        it('persists the transaction under the client-supplied _id', async () => {
            const clientId = freshId()
            const res = await request(app)
                .post('/api/v1/transactions')
                .set(authHeader(owner.token))
                .send({
                    _id: clientId,
                    type: 'expense',
                    title: 'Offline-created expense',
                    amount: 1500,
                    date: new Date().toISOString(),
                    accountId,
                    categoryId,
                })

            expect(res.status).toBe(201)
            expect(res.body.data._id).toBe(clientId)
            const stored = await Transaction.findById(clientId)
            expect(stored).not.toBeNull()
        })

        it('rejects an _id already used by one of the user\'s own transactions', async () => {
            const clientId = freshId()
            await request(app)
                .post('/api/v1/transactions')
                .set(authHeader(owner.token))
                .send({
                    _id: clientId,
                    type: 'expense',
                    title: 'First',
                    amount: 100,
                    date: new Date().toISOString(),
                    accountId,
                    categoryId,
                })

            const res = await request(app)
                .post('/api/v1/transactions')
                .set(authHeader(owner.token))
                .send({
                    _id: clientId,
                    type: 'expense',
                    title: 'Second, same id',
                    amount: 200,
                    date: new Date().toISOString(),
                    accountId,
                    categoryId,
                })

            expect(res.status).toBe(400)
        })

        it('rejects a syntactically invalid _id', async () => {
            const res = await request(app)
                .post('/api/v1/transactions')
                .set(authHeader(owner.token))
                .send({
                    _id: 'not-a-valid-object-id',
                    type: 'expense',
                    title: 'Bad id',
                    amount: 100,
                    date: new Date().toISOString(),
                    accountId,
                    categoryId,
                })

            expect(res.status).toBe(400)
        })

        it('still auto-generates an _id when none is supplied (existing behavior unchanged)', async () => {
            const res = await request(app)
                .post('/api/v1/transactions')
                .set(authHeader(owner.token))
                .send({
                    type: 'expense',
                    title: 'No client id',
                    amount: 100,
                    date: new Date().toISOString(),
                    accountId,
                    categoryId,
                })

            expect(res.status).toBe(201)
            expect(Types.ObjectId.isValid(res.body.data._id)).toBe(true)
        })
    })

    describe('POST /api/v1/accounts', () => {
        it('persists the account under the client-supplied _id', async () => {
            const clientId = freshId()
            const res = await request(app)
                .post('/api/v1/accounts')
                .set(authHeader(owner.token))
                .send({ _id: clientId, name: 'Offline Savings', type: 'savings' })

            expect(res.status).toBe(201)
            expect(res.body.data._id).toBe(clientId)
            const stored = await Account.findById(clientId)
            expect(stored).not.toBeNull()
        })

        it('rejects an _id already used by another of the user\'s accounts', async () => {
            const res = await request(app)
                .post('/api/v1/accounts')
                .set(authHeader(owner.token))
                .send({ _id: accountId, name: 'Collides', type: 'cash' })

            expect(res.status).toBe(400)
        })
    })

    describe('POST /api/v1/tags', () => {
        it('persists the tag under the client-supplied _id', async () => {
            const clientId = freshId()
            const res = await request(app)
                .post('/api/v1/tags')
                .set(authHeader(owner.token))
                .send({ _id: clientId, name: 'offline-tag' })

            expect(res.status).toBe(201)
            expect(res.body.data._id).toBe(clientId)
            const stored = await Tag.findById(clientId)
            expect(stored).not.toBeNull()
        })
    })

    describe('POST /api/v1/budgets', () => {
        it('persists the budget under the client-supplied _id', async () => {
            const clientId = freshId()
            const now = new Date()
            const res = await request(app)
                .post('/api/v1/budgets')
                .set(authHeader(owner.token))
                .send({
                    _id: clientId,
                    periodType: 'monthly',
                    year: now.getUTCFullYear(),
                    month: now.getUTCMonth() + 1,
                    amount: 50000,
                    categoryId,
                })

            expect(res.status).toBe(201)
            expect(res.body.data._id).toBe(clientId)
            const stored = await Budget.findById(clientId)
            expect(stored).not.toBeNull()
        })
    })

    describe('POST /api/v1/savings-goals', () => {
        it('persists the savings goal under the client-supplied _id', async () => {
            const clientId = freshId()
            const res = await request(app)
                .post('/api/v1/savings-goals')
                .set(authHeader(owner.token))
                .send({ _id: clientId, name: 'Offline Goal', targetAmount: 100000 })

            expect(res.status).toBe(201)
            expect(res.body.data._id).toBe(clientId)
            const stored = await SavingsGoal.findById(clientId)
            expect(stored).not.toBeNull()
        })
    })

    it('rejects a client _id already used by ANOTHER user in the same collection (Mongo _id is collection-wide unique, not per-user)', async () => {
        const other = await registerUser(app, { email: 'client-id-other@example.com' })
        const clientId = freshId()

        const ownerRes = await request(app)
            .post('/api/v1/tags')
            .set(authHeader(owner.token))
            .send({ _id: clientId, name: 'first-owner-tag' })
        const otherRes = await request(app)
            .post('/api/v1/tags')
            .set(authHeader(other.token))
            .send({ _id: clientId, name: 'second-owner-same-id' })

        expect(ownerRes.status).toBe(201)
        expect(otherRes.status).toBe(400)
    })
})
