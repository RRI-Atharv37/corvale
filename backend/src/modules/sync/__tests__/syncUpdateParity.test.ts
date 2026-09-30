import request from 'supertest'
import { Application } from 'express'
import { Types } from 'mongoose'
import { createApp } from '@http/app'
import { Account } from '@modules/accounts'
import { Category } from '@modules/categories'
import { Transaction } from '@modules/transactions'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { registerUser, authHeader, RegisteredUser } from '@tests/helpers'

/**
 * BUG-56: a sync `update` on a transaction must be refused wherever the REST PUT refuses it -
 * transfer legs, split parents and split children - and a fractional minor-unit amount must not be stored.
 */

const seedAccount = async (userId: string, name = 'Checking') =>
    Account.create({
        userId,
        name,
        type: 'checking',
        currency: 'USD',
        openingBalance: 1000,
        currentBalance: 1000,
    })

describe('Sync API - transaction update parity with REST', () => {
    let app: Application
    let owner: RegisteredUser

    const pushUpdate = async (payload: Record<string, unknown>, opId: string) => {
        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({ ops: [{ opId, entity: 'transaction', operation: 'update', payload }] })
        expect(res.status).toBe(200)
        return res.body.data.results[0] as { status: string; message?: string }
    }

    beforeEach(async () => {
        app = createApp()
        owner = await registerUser(app)
    })

    it('rejects a sync update to a transfer leg exactly as REST does and leaves both legs intact', async () => {
        const from = await seedAccount(owner.userId, 'From')
        const to = await seedAccount(owner.userId, 'To')
        const category = await Category.create({ userId: owner.userId, name: 'Transfers' })
        const outboundId = new Types.ObjectId()
        const inboundId = new Types.ObjectId()
        const base = {
            userId: owner.userId,
            categoryId: category._id,
            type: 'transfer',
            currency: 'USD',
            title: 'Move money',
            amount: 2500,
            date: new Date(),
        }
        await Transaction.create({
            ...base,
            _id: outboundId,
            accountId: from._id,
            transferRole: 'out',
            transferPairId: inboundId,
        })
        await Transaction.create({
            ...base,
            _id: inboundId,
            accountId: to._id,
            transferRole: 'in',
            transferPairId: outboundId,
        })

        const restRes = await request(app)
            .put(`/api/v1/transactions/${outboundId.toString()}`)
            .set(authHeader(owner.token))
            .send({ amount: 50 })
        expect(restRes.status).toBe(400)

        const result = await pushUpdate({ _id: outboundId.toString(), amount: 5000 }, 'transfer-leg-1')

        expect(result.status).toBe('rejected')
        expect(result.message).toBe(ERROR_MESSAGES.TRANSACTION.TRANSFER_NOT_EDITABLE)
        expect(result.message).toBe(restRes.body.message)
        expect((await Transaction.findById(outboundId))?.amount).toBe(2500)
        expect((await Transaction.findById(inboundId))?.amount).toBe(2500)
    })

    it('rejects a sync update to a split parent and leaves the parent and its children unchanged', async () => {
        const account = await seedAccount(owner.userId)
        const category = await Category.create({ userId: owner.userId, name: 'Groceries' })
        const parent = await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 3000,
            currency: 'USD',
            title: 'Supermarket',
            date: new Date(),
        })
        await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 1000,
            currency: 'USD',
            title: 'Supermarket',
            date: new Date(),
            splitTransactionId: parent._id,
        })
        await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 2000,
            currency: 'USD',
            title: 'Supermarket',
            date: new Date(),
            splitTransactionId: parent._id,
        })

        const restRes = await request(app)
            .put(`/api/v1/transactions/${parent._id.toString()}`)
            .set(authHeader(owner.token))
            .send({ amount: 50 })
        expect(restRes.status).toBe(400)

        const result = await pushUpdate({ _id: parent._id.toString(), amount: 5000 }, 'split-parent-1')

        expect(result.status).toBe('rejected')
        expect(result.message).toBe(ERROR_MESSAGES.TRANSACTION.SPLIT_NOT_EDITABLE)
        expect(result.message).toBe(restRes.body.message)
        expect((await Transaction.findById(parent._id))?.amount).toBe(3000)
        const children = await Transaction.find({ splitTransactionId: parent._id })
        expect(children.map((child) => child.amount).sort()).toEqual([1000, 2000])
    })

    it('rejects a sync update carrying a fractional minor-unit amount and stores nothing', async () => {
        const account = await seedAccount(owner.userId)
        const category = await Category.create({ userId: owner.userId, name: 'Groceries' })
        const transaction = await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 1000,
            currency: 'USD',
            title: 'Coffee',
            date: new Date(),
        })

        const result = await pushUpdate({ _id: transaction._id.toString(), amount: 1234.5 }, 'fractional-1')

        expect(result.status).toBe('rejected')
        expect(result.message).toBe('Invalid amount format')
        expect((await Transaction.findById(transaction._id))?.amount).toBe(1000)
    })

    it.each([
        ['negative', -100],
        ['non-numeric string', 'abc'],
        ['boolean', false],
    ])('rejects a %s amount on a sync update', async (_label, amount) => {
        const account = await seedAccount(owner.userId)
        const category = await Category.create({ userId: owner.userId, name: 'Groceries' })
        const transaction = await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 1000,
            currency: 'USD',
            title: 'Coffee',
            date: new Date(),
        })

        const result = await pushUpdate(
            { _id: transaction._id.toString(), amount },
            `bad-amount-${String(_label)}`
        )

        expect(result.status).toBe('rejected')
        expect((await Transaction.findById(transaction._id))?.amount).toBe(1000)
    })

    it('still applies an ordinary integer minor-unit amount edit on a plain transaction', async () => {
        const account = await seedAccount(owner.userId)
        const category = await Category.create({ userId: owner.userId, name: 'Groceries' })
        const transaction = await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 1000,
            currency: 'USD',
            title: 'Coffee',
            date: new Date(),
        })

        const result = await pushUpdate({ _id: transaction._id.toString(), amount: 1250 }, 'plain-ok-1')

        expect(result.status).toBe('applied')
        expect((await Transaction.findById(transaction._id))?.amount).toBe(1250)
    })
})
