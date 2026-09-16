import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Transaction } from '@modules/transactions'
import { authHeader, seedUserDirectly } from '@tests/helpers'
import { backfillHasSplitChildren } from '@migrations/hasSplitChildrenBackfill'

async function createTestAccount(token: string, openingBalance = 1000) {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name: 'Checking', type: 'checking', openingBalance })

    return res.body.data
}

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    return res.body.data.masters.find((m: { name: string }) => m.name === 'Food')._id
}

async function getTransportMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    return res.body.data.masters.find((m: { name: string }) => m.name === 'Transport')._id
}

/** Simulates a pre-BUG-34 split parent: created directly against the collection with children
 * pointing at it via splitTransactionId, bypassing createTransactionForUser (which now sets the
 * flag at create time) - this is the shape a real pre-fix parent has in the database. */
async function seedLegacySplitParent(token: string, userId: string, accountId: string, categoryId: string) {
    const parent = await Transaction.create({
        userId,
        accountId,
        categoryId,
        type: 'expense',
        status: 'posted',
        amount: 100,
        currency: 'USD',
        title: 'Legacy split parent',
        date: new Date('2026-01-05T12:00:00.000Z'),
    })

    await Transaction.insertMany([
        {
            userId,
            accountId,
            categoryId,
            type: 'expense',
            status: 'posted',
            amount: 60,
            currency: 'USD',
            title: 'Legacy split parent',
            date: new Date('2026-01-05T12:00:00.000Z'),
            splitTransactionId: parent._id,
        },
        {
            userId,
            accountId,
            categoryId,
            type: 'expense',
            status: 'posted',
            amount: 40,
            currency: 'USD',
            title: 'Legacy split parent',
            date: new Date('2026-01-05T12:00:00.000Z'),
            splitTransactionId: parent._id,
        },
    ])

    return parent
}

describe('backfillHasSplitChildren', () => {
    it('flags a pre-existing split parent that predates the field', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'split-backfill-basic@example.com' })
        const account = await createTestAccount(token)
        const foodCategoryId = await getFoodMasterId(token)
        const parent = await seedLegacySplitParent(token, userId, account._id, foodCategoryId)

        const result = await backfillHasSplitChildren()

        expect(result.dryRun).toBe(false)
        expect(result.parentsMatched).toBe(1)
        expect(result.parentsModified).toBe(1)

        const migrated = await Transaction.findById(parent._id)
        expect(migrated?.hasSplitChildren).toBe(true)
    })

    it('does not flag ordinary transactions or split children', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'split-backfill-ordinary@example.com' })
        const account = await createTestAccount(token)
        const foodCategoryId = await getFoodMasterId(token)
        const parent = await seedLegacySplitParent(token, userId, account._id, foodCategoryId)

        await backfillHasSplitChildren()

        const children = await Transaction.find({ splitTransactionId: parent._id })
        for (const child of children) {
            expect(child.hasSplitChildren).not.toBe(true)
        }
    })

    it('is idempotent - a second run reports zero modified', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'split-backfill-idempotent@example.com' })
        const account = await createTestAccount(token)
        const foodCategoryId = await getFoodMasterId(token)
        await seedLegacySplitParent(token, userId, account._id, foodCategoryId)

        const first = await backfillHasSplitChildren()
        expect(first.parentsModified).toBe(1)

        const second = await backfillHasSplitChildren()
        expect(second.parentsMatched).toBe(0)
        expect(second.parentsModified).toBe(0)
    })

    it('dry run reports the match count without persisting any change', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'split-backfill-dry-run@example.com' })
        const account = await createTestAccount(token)
        const foodCategoryId = await getFoodMasterId(token)
        const parent = await seedLegacySplitParent(token, userId, account._id, foodCategoryId)

        const result = await backfillHasSplitChildren({ dryRun: true })

        expect(result.dryRun).toBe(true)
        expect(result.parentsMatched).toBe(1)
        expect(result.parentsModified).toBe(0)

        const untouched = await Transaction.findById(parent._id)
        expect(untouched?.hasSplitChildren).not.toBe(true)
    })

    it('a parent created after BUG-34 shipped is already flagged and skipped by the backfill', async () => {
        const { token } = await seedUserDirectly({ email: 'split-backfill-post-fix@example.com' })
        const account = await createTestAccount(token)
        const foodCategoryId = await getFoodMasterId(token)
        const transportCategoryId = await getTransportMasterId(token)

        const createRes = await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(token))
            .send({
                type: 'expense',
                title: 'Fresh split',
                amount: 100,
                date: '2026-01-05T12:00:00.000Z',
                accountId: account._id,
                splits: [
                    { categoryId: foodCategoryId, amount: 60 },
                    { categoryId: transportCategoryId, amount: 40 },
                ],
            })

        expect(createRes.body.data.hasSplitChildren).toBe(true)

        const result = await backfillHasSplitChildren()

        expect(result.parentsMatched).toBe(0)
        expect(result.parentsModified).toBe(0)
    })
})
