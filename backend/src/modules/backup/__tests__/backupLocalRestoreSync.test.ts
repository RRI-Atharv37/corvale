import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'

import app from '@http/app'
import { Account } from '@modules/accounts'
import { Transaction } from '@modules/transactions'
import { authHeader, registerUser } from '@tests/helpers'

/**
 * S49 / BUG-62 + BUG-63, server half: the ops a desktop local restore queues (see
 * `frontend/corvale/src/domain/__tests__/backupRestoreLocal.test.ts`) must all be applied by
 * `/sync/push` - accounts without a client-set `currentBalance`, transfers as one grouped
 * `transaction.transfer` op, a split as one create carrying `splits` - and must leave linked rows and
 * a stored balance that matches the ledger, with nothing counted twice.
 */

const newId = () => new Types.ObjectId().toString()

const getMasterId = async (token: string, name: string): Promise<string> => {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const master = res.body.data.masters.find((m: { name: string }) => m.name === name)
    if (!master) throw new Error(`${name} master category not found`)
    return master._id
}

describe('Sync push of a locally restored backup', () => {
    it('applies accounts, a transfer and a split with linked rows and a ledger-true balance', async () => {
        const { token, userId } = await registerUser(app, { email: 'bug62-restore-sync@example.com' })
        const foodId = await getMasterId(token, 'Food')
        const shoppingId = await getMasterId(token, 'Shopping')

        const checkingId = newId()
        const savingsId = newId()
        const expenseId = newId()
        const outboundId = newId()
        const inboundId = newId()
        const parentId = newId()
        const childOneId = newId()
        const childTwoId = newId()

        const account = (id: string, name: string, type: string, openingBalance: number) => ({
            opId: `op-${id}`,
            entity: 'account',
            operation: 'create',
            payload: {
                _id: id,
                workspaceId: null,
                name,
                type,
                currency: 'USD',
                openingBalance,
                openingBalanceDate: null,
                isArchived: false,
            },
        })

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(token))
            .send({
                ops: [
                    account(checkingId, 'Checking', 'checking', 1000),
                    account(savingsId, 'Savings', 'savings', 500),
                    {
                        opId: 'op-expense',
                        entity: 'transaction',
                        operation: 'create',
                        payload: {
                            _id: expenseId,
                            type: 'expense',
                            status: 'posted',
                            title: 'Groceries',
                            amount: 2250,
                            date: '2026-01-15T12:00:00.000Z',
                            accountId: checkingId,
                            categoryId: foodId,
                            currency: 'USD',
                            clearedStatus: 'pending',
                            tags: [],
                            splitTransactionId: null,
                            transferPairId: null,
                        },
                    },
                    {
                        opId: 'op-transfer',
                        entity: 'transaction',
                        operation: 'create',
                        payload: {
                            intent: 'transaction.transfer',
                            _id: outboundId,
                            pairId: inboundId,
                            amount: 10000,
                            date: '2026-01-16T12:00:00.000Z',
                            fromAccountId: checkingId,
                            toAccountId: savingsId,
                            title: 'Move to savings',
                            workspaceId: null,
                        },
                    },
                    {
                        opId: 'op-split',
                        entity: 'transaction',
                        operation: 'create',
                        payload: {
                            _id: parentId,
                            type: 'expense',
                            status: 'posted',
                            title: 'Mixed shopping trip',
                            amount: 10000,
                            date: '2026-01-17T12:00:00.000Z',
                            accountId: checkingId,
                            workspaceId: null,
                            splits: [
                                { _id: childOneId, categoryId: foodId, amount: 6000 },
                                { _id: childTwoId, categoryId: shoppingId, amount: 4000 },
                            ],
                        },
                    },
                ],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.results.map((r: { status: string }) => r.status)).toEqual([
            'applied',
            'applied',
            'applied',
            'applied',
            'applied',
        ])

        const outbound = await Transaction.findById(outboundId)
        const inbound = await Transaction.findById(inboundId)
        expect(String(outbound?.transferPairId)).toBe(inboundId)
        expect(String(inbound?.transferPairId)).toBe(outboundId)
        expect(String(outbound?.accountId)).toBe(checkingId)
        expect(String(inbound?.accountId)).toBe(savingsId)

        const children = await Transaction.find({ splitTransactionId: parentId })
        expect(children.map((child) => String(child._id)).sort()).toEqual([childOneId, childTwoId].sort())
        expect(children.reduce((sum, child) => sum + child.amount, 0)).toBe(10000)
        expect((await Transaction.findById(parentId))?.hasSplitChildren).toBe(true)

        const standalone = await Transaction.find({ userId, type: 'expense', splitTransactionId: null })
        expect(standalone.reduce((sum, row) => sum + row.amount, 0)).toBe(2250 + 10000)

        const checking = await Account.findById(checkingId)
        const savings = await Account.findById(savingsId)
        expect(checking?.currentBalance).toBeCloseTo(1000 - 22.5 - 100 - 100, 2)
        expect(savings?.currentBalance).toBeCloseTo(600, 2)
    })

    it('still refuses a client-set currentBalance on an account create', async () => {
        const { token } = await registerUser(app, { email: 'bug62-current-balance@example.com' })

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(token))
            .send({
                ops: [
                    {
                        opId: 'op-account',
                        entity: 'account',
                        operation: 'create',
                        payload: {
                            _id: newId(),
                            name: 'Inflated',
                            type: 'checking',
                            currency: 'USD',
                            openingBalance: 100000,
                            currentBalance: 100000,
                        },
                    },
                ],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.results[0].status).toBe('rejected')
        expect(await Account.countDocuments({ name: 'Inflated' })).toBe(0)
    })
})
