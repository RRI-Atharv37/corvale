import { describe, it, expect } from 'vitest'
import { Types } from 'mongoose'

import app from '../app'
import Transaction from '../models/Transaction'
import { RLS_BYPASS, RLS_ALLOW_LOOKUP, runWithRlsContext } from '@core/access/rowLevelSecurity'
import { registerUser } from './helpers'

const UNSCOPED = /missing user or workspace scope/i
const UNREVIEWED_LOOKUP = /rlsAllowLookup/i

const scopedMatch = (userId: string) => ({ $match: { userId: new Types.ObjectId(userId) } })

const categoryLookup = {
    $lookup: {
        from: 'categories',
        localField: 'categoryId',
        foreignField: '_id',
        as: 'category',
    },
}

/**
 * P6 / SEC-58 (S33) — the RLS aggregate guard only inspects outer `$match` stages, so a
 * `$lookup` (or `$graphLookup` / `$unionWith`) pulls a whole other collection past the
 * tenancy boundary unnoticed. The guard now rejects every cross-collection stage while an
 * RLS context is active unless the caller opts in with `.option({ [RLS_ALLOW_LOOKUP]: true })`
 * (a deliberate "I have scoped the joined collection myself" acknowledgement) or the full
 * `RLS_BYPASS`.
 */
describe('P6 / SEC-58 — RLS aggregate cross-collection guard', () => {
    it('rejects an aggregate $lookup under an RLS context even with a scoped outer $match', async () => {
        const user = await registerUser(app)
        await runWithRlsContext({ userId: user.userId }, async () => {
            await expect(
                Transaction.aggregate([scopedMatch(user.userId), categoryLookup])
            ).rejects.toThrow(UNREVIEWED_LOOKUP)
        })
    })

    it('allows the $lookup with an explicit rlsAllowLookup option and a scoped outer $match', async () => {
        const user = await registerUser(app)
        await runWithRlsContext({ userId: user.userId }, async () => {
            await expect(
                Transaction.aggregate([scopedMatch(user.userId), categoryLookup]).option({
                    [RLS_ALLOW_LOOKUP]: true,
                })
            ).resolves.toBeDefined()
        })
    })

    it('still rejects a $lookup that opts in via rlsAllowLookup but has no scoped outer $match', async () => {
        const user = await registerUser(app)
        await runWithRlsContext({ userId: user.userId }, async () => {
            await expect(
                Transaction.aggregate([{ $match: { title: 'x' } }, categoryLookup]).option({
                    [RLS_ALLOW_LOOKUP]: true,
                })
            ).rejects.toThrow(UNSCOPED)
        })
    })

    it('rejects a $unionWith stage the same way', async () => {
        const user = await registerUser(app)
        await runWithRlsContext({ userId: user.userId }, async () => {
            await expect(
                Transaction.aggregate([
                    scopedMatch(user.userId),
                    { $unionWith: { coll: 'categories', pipeline: [] } },
                ])
            ).rejects.toThrow(UNREVIEWED_LOOKUP)
        })
    })

    it('allows the $lookup under a full RLS bypass', async () => {
        const user = await registerUser(app)
        await runWithRlsContext({ userId: user.userId }, async () => {
            await expect(
                Transaction.aggregate([categoryLookup]).option({ [RLS_BYPASS]: true })
            ).resolves.toBeDefined()
        })
    })

    it('allows an aggregate $lookup with no RLS context active', async () => {
        await expect(Transaction.aggregate([categoryLookup])).resolves.toBeDefined()
    })

    it('leaves $lookup-free aggregates untouched (regression)', async () => {
        const user = await registerUser(app)
        await runWithRlsContext({ userId: user.userId }, async () => {
            await expect(
                Transaction.aggregate([
                    scopedMatch(user.userId),
                    { $group: { _id: null, n: { $sum: 1 } } },
                ])
            ).resolves.toBeDefined()
        })
    })
})
