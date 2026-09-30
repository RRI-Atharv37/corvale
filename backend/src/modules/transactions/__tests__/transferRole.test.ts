import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'

import app from '@http/app'
import { Account } from '@modules/accounts'
import { Transaction } from '@modules/transactions'
import { backfillTransferRoles } from '@migrations/transferRoleBackfill'
import { authHeader, seedUserDirectly } from '@tests/helpers'

/**
 * S53 / BUG-67: each transfer leg stores which side it is, so direction never depends on two
 * creation timestamps differing. Covers REST and sync creates, a restore of an export whose legs
 * all share one `createdAt`, recompute and list parity, and the backfill for legacy legs.
 */

const createAccount = async (token: string, name: string, openingBalance: number) => {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'checking', openingBalance })
    return res.body.data
}

const createTransfer = async (token: string, fromAccountId: string, toAccountId: string, amount = 10) => {
    const res = await request(app)
        .post('/api/v1/transactions/transfer')
        .set(authHeader(token))
        .send({
            title: 'Move',
            amount,
            date: '2026-01-16T12:00:00.000Z',
            fromAccountId,
            toAccountId,
        })
    return res.body.data as { outbound: { _id: string }; inbound: { _id: string } }
}

const recompute = async (token: string, accountId: string): Promise<number> => {
    const res = await request(app)
        .post(`/api/v1/accounts/${accountId}/recompute-balance`)
        .set(authHeader(token))
    expect(res.status).toBe(200)
    return res.body.data.recomputedBalance
}

const sameInstant = async (ids: string[], stamp = new Date('2026-02-01T00:00:00.000Z')) => {
    await Transaction.collection.updateMany(
        { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
        { $set: { createdAt: stamp } }
    )
}

const stripRoles = async (ids: string[]) => {
    await Transaction.collection.updateMany(
        { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
        { $unset: { transferRole: '' } }
    )
}

describe('Transfer legs store their role (BUG-67)', () => {
    it('stamps out on the debited leg and in on the credited leg for a REST transfer', async () => {
        const { token } = await seedUserDirectly({ email: 's53-rest@example.com' })
        const checking = await createAccount(token, 'Checking', 1000)
        const savings = await createAccount(token, 'Savings', 0)

        const { outbound, inbound } = await createTransfer(token, checking._id, savings._id)

        expect((await Transaction.findById(outbound._id))?.transferRole).toBe('out')
        expect((await Transaction.findById(inbound._id))?.transferRole).toBe('in')
    })

    it('stamps both legs of a grouped sync transaction.transfer, whatever the creation times', async () => {
        const { token, userId } = await seedUserDirectly({ email: 's53-sync@example.com' })
        const from = await Account.create({
            userId,
            name: 'From',
            type: 'checking',
            currency: 'USD',
            openingBalance: 1000,
            currentBalance: 1000,
        })
        const to = await Account.create({
            userId,
            name: 'To',
            type: 'checking',
            currency: 'USD',
            openingBalance: 0,
            currentBalance: 0,
        })
        const outboundId = new Types.ObjectId().toString()
        const inboundId = new Types.ObjectId().toString()

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(token))
            .send({
                ops: [
                    {
                        opId: 'transfer-roles-1',
                        entity: 'transaction',
                        operation: 'create',
                        payload: {
                            intent: 'transaction.transfer',
                            _id: outboundId,
                            pairId: inboundId,
                            amount: 4000,
                            date: new Date().toISOString(),
                            fromAccountId: from._id.toString(),
                            toAccountId: to._id.toString(),
                        },
                    },
                ],
            })
        expect(res.body.data.results[0].status).toBe('applied')

        expect((await Transaction.findById(outboundId))?.transferRole).toBe('out')
        expect((await Transaction.findById(inboundId))?.transferRole).toBe('in')

        await sameInstant([outboundId, inboundId])
        expect(await recompute(token, to._id.toString())).toBeCloseTo(40, 2)
        expect(await recompute(token, from._id.toString())).toBeCloseTo(960, 2)
    })

    it('reads direction from the stored role when both legs share one millisecond', async () => {
        const { token } = await seedUserDirectly({ email: 's53-tie@example.com' })
        const checking = await createAccount(token, 'Checking', 1000)
        const savings = await createAccount(token, 'Savings', 500)
        const { outbound, inbound } = await createTransfer(token, checking._id, savings._id, 25)
        await sameInstant([outbound._id, inbound._id])

        expect(await recompute(token, checking._id)).toBeCloseTo(975, 2)
        expect(await recompute(token, savings._id)).toBeCloseTo(525, 2)

        const list = await request(app).get('/api/v1/transactions').set(authHeader(token))
        const listed = list.body.data.data as { _id: string; transferDirection?: string }[]
        expect(listed.find((tx) => tx._id === outbound._id)?.transferDirection).toBe('out')
        expect(listed.find((tx) => tx._id === inbound._id)?.transferDirection).toBe('in')

        const detail = await request(app)
            .get(`/api/v1/transactions/${inbound._id}`)
            .set(authHeader(token))
        expect(detail.body.data.transferDirection).toBe('in')
        expect(detail.body.data.transferPair.transferDirection).toBe('out')
    })

    it('reverses the right accounts when a tied transfer is deleted', async () => {
        const { token } = await seedUserDirectly({ email: 's53-delete@example.com' })
        const checking = await createAccount(token, 'Checking', 1000)
        const savings = await createAccount(token, 'Savings', 500)
        const { outbound, inbound } = await createTransfer(token, checking._id, savings._id, 25)
        await sameInstant([outbound._id, inbound._id])

        const res = await request(app)
            .delete(`/api/v1/transactions/${inbound._id}`)
            .set(authHeader(token))
        expect(res.status).toBe(200)

        expect((await Account.findById(checking._id))?.currentBalance).toBeCloseTo(1000, 2)
        expect((await Account.findById(savings._id))?.currentBalance).toBeCloseTo(500, 2)
    })
})

describe('Backup restore keeps every leg\'s direction (BUG-67)', () => {
    const exportAndRestore = async (
        source: { token: string },
        target: { token: string },
        mutate: (transactions: Record<string, unknown>[]) => Record<string, unknown>[]
    ) => {
        const exportRes = await request(app).get('/api/v1/backup/export').set(authHeader(source.token))
        const backup = { ...exportRes.body, transactions: mutate(exportRes.body.transactions) }
        const restoreRes = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(target.token))
            .send({ backup })
        expect(restoreRes.status).toBe(201)
        return exportRes.body
    }

    const seedSource = async (email: string) => {
        const source = await seedUserDirectly({ email })
        const checking = await createAccount(source.token, 'Checking', 1000)
        const savings = await createAccount(source.token, 'Savings', 500)
        for (let i = 0; i < 4; i += 1) {
            await createTransfer(source.token, checking._id, savings._id, 10 + i)
        }
        return { source, checking, savings }
    }

    const expectBalancesMatchSource = async (
        target: { token: string; userId: string },
        expected: { checking: number; savings: number }
    ) => {
        const checking = await Account.findOne({ userId: target.userId, name: 'Checking' })
        const savings = await Account.findOne({ userId: target.userId, name: 'Savings' })
        expect(await recompute(target.token, checking!._id.toString())).toBeCloseTo(expected.checking, 2)
        expect(await recompute(target.token, savings!._id.toString())).toBeCloseTo(expected.savings, 2)
        expect(checking!.currentBalance).toBeCloseTo(expected.checking, 2)
        expect(savings!.currentBalance).toBeCloseTo(expected.savings, 2)
    }

    it('exports each leg\'s role and restores it onto the same side', async () => {
        const { source } = await seedSource('s53-export-source@example.com')
        const target = await seedUserDirectly({ email: 's53-export-target@example.com' })

        const exported = await exportAndRestore(source, target, (transactions) => transactions)
        const exportedRoles = (exported.transactions as { transferRole?: string }[]).map((tx) => tx.transferRole)
        expect(exportedRoles.filter((role) => role === 'out')).toHaveLength(4)
        expect(exportedRoles.filter((role) => role === 'in')).toHaveLength(4)

        const restored = await Transaction.find({ userId: target.userId, type: 'transfer' }).lean()
        expect(restored.filter((tx) => tx.transferRole === 'out')).toHaveLength(4)
        expect(restored.filter((tx) => tx.transferRole === 'in')).toHaveLength(4)
        const byId = new Map(restored.map((tx) => [tx._id.toString(), tx]))
        for (const leg of restored) {
            const pair = byId.get(String(leg.transferPairId))!
            expect(pair.transferRole).not.toBe(leg.transferRole)
        }

        await expectBalancesMatchSource(target, { checking: 1000 - 46, savings: 500 + 46 })
    })

    it('restores a file whose legs all share one createdAt', async () => {
        const { source } = await seedSource('s53-tied-source@example.com')
        const target = await seedUserDirectly({ email: 's53-tied-target@example.com' })

        await exportAndRestore(source, target, (transactions) =>
            transactions.map((tx) => ({ ...tx, createdAt: '2026-02-01T00:00:00.000Z' }))
        )

        await expectBalancesMatchSource(target, { checking: 954, savings: 546 })
        const list = await request(app).get('/api/v1/transactions').set(authHeader(target.token))
        const directions = (list.body.data.data as { type: string; transferDirection?: string }[])
            .filter((tx) => tx.type === 'transfer')
            .map((tx) => tx.transferDirection)
        expect(directions.filter((direction) => direction === 'out')).toHaveLength(4)
        expect(directions.filter((direction) => direction === 'in')).toHaveLength(4)
    })

    it('restores an older file with no roles and tied creation times: one out and one in per pair', async () => {
        const { source } = await seedSource('s53-legacy-source@example.com')
        const target = await seedUserDirectly({ email: 's53-legacy-target@example.com' })

        await exportAndRestore(source, target, (transactions) =>
            transactions.map(({ transferRole: _role, ...rest }) => ({
                ...rest,
                createdAt: '2026-02-01T00:00:00.000Z',
            }))
        )

        const restored = await Transaction.find({ userId: target.userId, type: 'transfer' }).lean()
        expect(restored.every((tx) => tx.transferRole === 'out' || tx.transferRole === 'in')).toBe(true)
        const byId = new Map(restored.map((tx) => [tx._id.toString(), tx]))
        for (const leg of restored) {
            expect(byId.get(String(leg.transferPairId))!.transferRole).not.toBe(leg.transferRole)
        }
        const outbound = restored.filter((tx) => tx.transferRole === 'out')
        const checking = await Account.findOne({ userId: target.userId, name: 'Checking' })
        expect(outbound.every((tx) => tx.accountId.equals(checking!._id))).toBe(true)
    })

    it('lets the file\'s own role win over creation order', async () => {
        const { source } = await seedSource('s53-role-wins-source@example.com')
        const target = await seedUserDirectly({ email: 's53-role-wins-target@example.com' })

        await exportAndRestore(source, target, (transactions) =>
            transactions.map((tx) => ({
                ...tx,
                createdAt: tx.transferRole === 'out' ? '2026-03-01T00:00:00.000Z' : '2026-01-01T00:00:00.000Z',
            }))
        )

        await expectBalancesMatchSource(target, { checking: 954, savings: 546 })
    })
})

describe('Transfer role backfill (BUG-67)', () => {
    const seedLegacyPair = async (
        userId: string,
        accountIds: [string, string],
        createdAt: [Date, Date],
        overrides: Partial<Record<string, unknown>> = {}
    ) => {
        const outboundId = new Types.ObjectId()
        const inboundId = new Types.ObjectId()
        const base = {
            userId: new Types.ObjectId(userId),
            categoryId: new Types.ObjectId(),
            type: 'transfer',
            status: 'posted',
            amount: 1000,
            currency: 'USD',
            title: 'Legacy transfer',
            date: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date(),
            ...overrides,
        }
        await Transaction.collection.insertMany([
            {
                ...base,
                _id: outboundId,
                accountId: new Types.ObjectId(accountIds[0]),
                transferPairId: inboundId,
                createdAt: createdAt[0],
            },
            {
                ...base,
                _id: inboundId,
                accountId: new Types.ObjectId(accountIds[1]),
                transferPairId: outboundId,
                createdAt: createdAt[1],
            },
        ])
        return { outboundId, inboundId }
    }

    const roleOf = async (id: Types.ObjectId) =>
        (await Transaction.findOne({ _id: id }, null, { softDeleteBypass: true }).lean())?.transferRole

    it('gives the earlier leg out and the later leg in, leaving balances unchanged', async () => {
        const { userId } = await seedUserDirectly({ email: 's53-backfill@example.com' })
        const accounts = [new Types.ObjectId().toString(), new Types.ObjectId().toString()] as [string, string]
        const { outboundId, inboundId } = await seedLegacyPair(userId, accounts, [
            new Date('2026-01-01T00:00:00.000Z'),
            new Date('2026-01-01T00:00:00.001Z'),
        ])

        const result = await backfillTransferRoles()

        expect(result).toEqual({ dryRun: false, legsMatched: 2, legsModified: 2, orphanedLegs: 0 })
        expect(await roleOf(outboundId)).toBe('out')
        expect(await roleOf(inboundId)).toBe('in')
    })

    it('resolves a same-millisecond pair to exactly one out and one in', async () => {
        const { userId } = await seedUserDirectly({ email: 's53-backfill-tie@example.com' })
        const accounts = [new Types.ObjectId().toString(), new Types.ObjectId().toString()] as [string, string]
        const stamp = new Date('2026-01-01T00:00:00.000Z')
        const { outboundId, inboundId } = await seedLegacyPair(userId, accounts, [stamp, stamp])

        await backfillTransferRoles()

        const roles = [await roleOf(outboundId), await roleOf(inboundId)].sort()
        expect(roles).toEqual(['in', 'out'])
    })

    it('stamps a tombstoned pair too', async () => {
        const { userId } = await seedUserDirectly({ email: 's53-backfill-tombstone@example.com' })
        const accounts = [new Types.ObjectId().toString(), new Types.ObjectId().toString()] as [string, string]
        const { outboundId, inboundId } = await seedLegacyPair(
            userId,
            accounts,
            [new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.001Z')],
            { deletedAt: new Date() }
        )

        await backfillTransferRoles()

        expect(await roleOf(outboundId)).toBe('out')
        expect(await roleOf(inboundId)).toBe('in')
    })

    it('writes nothing on a dry run and is a no-op on a second run', async () => {
        const { userId } = await seedUserDirectly({ email: 's53-backfill-dry@example.com' })
        const accounts = [new Types.ObjectId().toString(), new Types.ObjectId().toString()] as [string, string]
        const { outboundId } = await seedLegacyPair(userId, accounts, [
            new Date('2026-01-01T00:00:00.000Z'),
            new Date('2026-01-01T00:00:00.001Z'),
        ])

        const dry = await backfillTransferRoles({ dryRun: true })
        expect(dry).toEqual({ dryRun: true, legsMatched: 2, legsModified: 0, orphanedLegs: 0 })
        expect(await roleOf(outboundId)).toBeFalsy()

        await backfillTransferRoles()
        const again = await backfillTransferRoles()
        expect(again).toEqual({ dryRun: false, legsMatched: 0, legsModified: 0, orphanedLegs: 0 })
    })

    it('counts and skips a leg whose pair is gone', async () => {
        const { userId } = await seedUserDirectly({ email: 's53-backfill-orphan@example.com' })
        const accounts = [new Types.ObjectId().toString(), new Types.ObjectId().toString()] as [string, string]
        const { outboundId, inboundId } = await seedLegacyPair(userId, accounts, [
            new Date('2026-01-01T00:00:00.000Z'),
            new Date('2026-01-01T00:00:00.001Z'),
        ])
        await Transaction.collection.deleteOne({ _id: inboundId })

        const result = await backfillTransferRoles()

        expect(result.orphanedLegs).toBe(1)
        expect(await roleOf(outboundId)).toBeFalsy()
    })

    it('keeps recompute correct for legacy legs that have not been backfilled yet', async () => {
        const { token } = await seedUserDirectly({ email: 's53-legacy-read@example.com' })
        const checking = await createAccount(token, 'Checking', 1000)
        const savings = await createAccount(token, 'Savings', 500)
        const { outbound, inbound } = await createTransfer(token, checking._id, savings._id, 25)
        await stripRoles([outbound._id, inbound._id])

        expect(await recompute(token, checking._id)).toBeCloseTo(975, 2)
        expect(await recompute(token, savings._id)).toBeCloseTo(525, 2)
    })
})
