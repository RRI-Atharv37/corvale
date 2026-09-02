import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'
import app from '@http/app'
import { Account } from '@modules/accounts'
import { Expense } from '@modules/legacy'
import { Income } from '@modules/legacy'
import { Transaction } from '@modules/transactions'
import {
    assertQueryIsScoped,
    filterHasOwnershipScope,
    pipelineHasOwnershipScope,
    runWithRlsContext,
} from '@core/access/rowLevelSecurity'
import { authHeader, registerUser, createSecondUser } from './helpers'

describe('Row-level security', () => {
    it('allows scoped filters with userId', () => {
        expect(filterHasOwnershipScope({ userId: new Types.ObjectId() })).toBe(true)
    })

    it('allows workspace-scoped filters when enabled', () => {
        expect(
            filterHasOwnershipScope(
                { workspaceId: new Types.ObjectId() },
                { supportsWorkspace: true }
            )
        ).toBe(true)
    })

    it('SEC-63: a top-level workspaceId alongside $or only counts when supportsWorkspace is set', () => {
        const filter = {
            workspaceId: new Types.ObjectId(),
            $or: [{ status: 'posted' }, { status: 'draft' }],
        }
        // Mirrors the plain `workspaceId` branch: without supportsWorkspace, workspaceId is not a
        // tenancy key and the $or clauses (both unscoped) must fail the guard.
        expect(filterHasOwnershipScope(filter)).toBe(false)
        expect(filterHasOwnershipScope(filter, { supportsWorkspace: true })).toBe(true)
    })

    it('blocks unscoped filters', () => {
        expect(filterHasOwnershipScope({ status: 'posted' })).toBe(false)
        expect(() => assertQueryIsScoped({ status: 'posted' })).toThrow(/missing user or workspace scope/i)
    })

    it('allows findById-style filters for post-fetch ownership checks', () => {
        expect(filterHasOwnershipScope({ _id: new Types.ObjectId() })).toBe(true)
    })

    it('allows aggregate pipelines with a scoped $match stage', () => {
        const pipeline = [{ $match: { userId: new Types.ObjectId() } }, { $group: { _id: '$type' } }]
        expect(pipelineHasOwnershipScope(pipeline)).toBe(true)
    })

    it('blocks unscoped queries during authenticated requests', async () => {
        const user = await registerUser(app)

        await runWithRlsContext({ userId: user.userId }, async () => {
            await expect(Transaction.find({ status: 'posted' })).rejects.toThrow(
                /missing user or workspace scope/i
            )
        })
    })

    it('allows unscoped queries outside authenticated request context', async () => {
        await Transaction.create({
            userId: new Types.ObjectId(),
            accountId: new Types.ObjectId(),
            categoryId: new Types.ObjectId(),
            type: 'expense',
            amount: 100,
            currency: 'USD',
            title: 'Seed',
            date: new Date(),
        })

        const results = await Transaction.find({ status: 'posted' })
        expect(results.length).toBeGreaterThanOrEqual(0)
    })
})

describe('Ownership enforcement', () => {
    it('returns 403 when accessing another user expense', async () => {
        const owner = await registerUser(app)
        const other = await createSecondUser(app)

        const expense = await Expense.create({
            userId: owner.userId,
            title: 'Owner expense',
            amount: 50,
            category: 'Food',
            date: new Date(),
        })

        const res = await request(app)
            .get(`/api/v1/expense/${expense._id}`)
            .set(authHeader(other.token))

        expect(res.status).toBe(403)
        expect(res.body.success).toBe(false)
        expect(res.body.message).toMatch(/not authorized/i)
    })

    it('returns 403 when accessing another user income', async () => {
        const owner = await registerUser(app)
        const other = await createSecondUser(app)

        const income = await Income.create({
            userId: owner.userId,
            title: 'Owner income',
            amount: 1000,
            date: new Date(),
        })

        const res = await request(app)
            .get(`/api/v1/income/${income._id}`)
            .set(authHeader(other.token))

        expect(res.status).toBe(403)
        expect(res.body.success).toBe(false)
        expect(res.body.message).toMatch(/not authorized/i)
    })

    it('returns 403 when accessing another user account', async () => {
        const owner = await registerUser(app)
        const other = await createSecondUser(app)

        const account = await Account.create({
            userId: owner.userId,
            name: 'Owner checking',
            type: 'checking',
            currency: 'USD',
            openingBalance: 0,
            currentBalance: 0,
        })

        const res = await request(app)
            .get(`/api/v1/accounts/${account._id}`)
            .set(authHeader(other.token))

        expect(res.status).toBe(403)
        expect(res.body.success).toBe(false)
        expect(res.body.message).toMatch(/not authorized/i)
    })

    it('returns 403 when accessing another user transaction', async () => {
        const owner = await registerUser(app)
        const other = await createSecondUser(app)

        const account = await Account.create({
            userId: owner.userId,
            name: 'Owner checking',
            type: 'checking',
            currency: 'USD',
            openingBalance: 0,
            currentBalance: 10000,
        })

        const transaction = await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: new Types.ObjectId(),
            type: 'expense',
            amount: 500,
            currency: 'USD',
            title: 'Owner transaction',
            date: new Date(),
        })

        const res = await request(app)
            .get(`/api/v1/transactions/${transaction._id}`)
            .set(authHeader(other.token))

        expect(res.status).toBe(403)
        expect(res.body.success).toBe(false)
        expect(res.body.message).toMatch(/not authorized/i)
    })
})
