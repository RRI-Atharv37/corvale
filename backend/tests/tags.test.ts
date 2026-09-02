import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Transaction } from '@modules/transactions'
import { authHeader, createSecondUser, seedUserDirectly } from './helpers'

async function createTestAccount(token: string, openingBalance = 1000) {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name: 'Checking', type: 'checking', openingBalance })
    return res.body.data
}

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const food = res.body.data.masters.find((m: { name: string }) => m.name === 'Food')
    if (!food) throw new Error('Food master category not found')
    return food._id
}

async function createTaggedTransaction(
    token: string,
    accountId: string,
    categoryId: string,
    title: string,
    tags: string[]
) {
    return request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({
            type: 'expense',
            title,
            amount: 10,
            date: '2026-01-15T12:00:00.000Z',
            accountId,
            categoryId,
            tags,
        })
}

describe('Tags - CRUD and ownership', () => {
    it('creates a tag with name and color', async () => {
        const { token } = await seedUserDirectly({ email: 'tag-create@example.com' })

        const res = await request(app)
            .post('/api/v1/tags')
            .set(authHeader(token))
            .send({ name: 'Travel', color: '#FF5733' })

        expect(res.status).toBe(201)
        expect(res.body.data.name).toBe('Travel')
        expect(res.body.data.color).toBe('#FF5733')
    })

    it('rejects duplicate tag names case-insensitively', async () => {
        const { token } = await seedUserDirectly({ email: 'tag-dup@example.com' })

        await request(app)
            .post('/api/v1/tags')
            .set(authHeader(token))
            .send({ name: 'Work' })

        const res = await request(app)
            .post('/api/v1/tags')
            .set(authHeader(token))
            .send({ name: 'work' })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/already exists/i)
    })

    it('lists tags scoped to authenticated user', async () => {
        const owner = await seedUserDirectly({ email: 'tag-owner@example.com' })
        const other = await createSecondUser(app)

        await request(app)
            .post('/api/v1/tags')
            .set(authHeader(owner.token))
            .send({ name: 'Owner Tag' })

        await request(app)
            .post('/api/v1/tags')
            .set(authHeader(other.token))
            .send({ name: 'Other Tag' })

        const res = await request(app).get('/api/v1/tags').set(authHeader(owner.token))

        expect(res.status).toBe(200)
        expect(res.body.data).toHaveLength(1)
        expect(res.body.data[0].name).toBe('Owner Tag')
    })

    it('updates tag name and propagates rename to transactions', async () => {
        const { token } = await seedUserDirectly({ email: 'tag-rename@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const createTagRes = await request(app)
            .post('/api/v1/tags')
            .set(authHeader(token))
            .send({ name: 'OldLabel' })

        const tagId = createTagRes.body.data._id

        await createTaggedTransaction(token, account._id, categoryId, 'Coffee', ['OldLabel'])

        const updateRes = await request(app)
            .put(`/api/v1/tags/${tagId}`)
            .set(authHeader(token))
            .send({ name: 'NewLabel', color: '#00FF00' })

        expect(updateRes.status).toBe(200)
        expect(updateRes.body.data.name).toBe('NewLabel')
        expect(updateRes.body.data.color).toBe('#00FF00')

        const transaction = await Transaction.findOne({ userId: createTagRes.body.data.userId })
        expect(transaction?.tags).toEqual(['NewLabel'])
    })

    it('deletes a tag', async () => {
        const { token } = await seedUserDirectly({ email: 'tag-delete@example.com' })

        const createRes = await request(app)
            .post('/api/v1/tags')
            .set(authHeader(token))
            .send({ name: 'Temporary' })

        const tagId = createRes.body.data._id

        const deleteRes = await request(app)
            .delete(`/api/v1/tags/${tagId}`)
            .set(authHeader(token))

        expect(deleteRes.status).toBe(200)

        const getRes = await request(app)
            .get(`/api/v1/tags/${tagId}`)
            .set(authHeader(token))

        expect(getRes.status).toBe(404)
    })

    it('returns 403 when accessing another user tag', async () => {
        const owner = await seedUserDirectly({ email: 'tag-owner403@example.com' })
        const other = await createSecondUser(app)

        const createRes = await request(app)
            .post('/api/v1/tags')
            .set(authHeader(owner.token))
            .send({ name: 'Private' })

        const tagId = createRes.body.data._id

        const res = await request(app)
            .get(`/api/v1/tags/${tagId}`)
            .set(authHeader(other.token))

        expect(res.status).toBe(403)
    })

    it('dedupe imports unique inline tags from transactions', async () => {
        const { token } = await seedUserDirectly({ email: 'tag-dedupe@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        await createTaggedTransaction(token, account._id, categoryId, 'Trip', ['Vacation'])
        await createTaggedTransaction(token, account._id, categoryId, 'Flight', ['Work'])

        const res = await request(app)
            .post('/api/v1/tags/dedupe')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.created).toBe(2)
        expect(res.body.data.tags.map((t: { name: string }) => t.name).sort()).toEqual([
            'Vacation',
            'Work',
        ])

        const dedupeAgain = await request(app)
            .post('/api/v1/tags/dedupe')
            .set(authHeader(token))

        expect(dedupeAgain.body.data.created).toBe(0)
        expect(dedupeAgain.body.data.skipped).toBe(2)
    })
})

describe('Tags - transaction filter', () => {
    it('filters transactions by tags query param', async () => {
        const { token } = await seedUserDirectly({ email: 'tag-filter@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        await createTaggedTransaction(token, account._id, categoryId, 'Tagged One', ['groceries'])
        await createTaggedTransaction(token, account._id, categoryId, 'Tagged Two', ['travel'])
        await createTaggedTransaction(token, account._id, categoryId, 'Untagged', [])

        const res = await request(app)
            .get('/api/v1/transactions')
            .query({ tags: 'groceries,travel' })
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.data).toHaveLength(2)
        const titles = res.body.data.data.map((t: { title: string }) => t.title).sort()
        expect(titles).toEqual(['Tagged One', 'Tagged Two'])
    })

    it('filters transactions by tag on date-range endpoint', async () => {
        const { token } = await seedUserDirectly({ email: 'tag-filter-date@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        await createTaggedTransaction(token, account._id, categoryId, 'In Range', ['bills'])
        await createTaggedTransaction(token, account._id, categoryId, 'Other Tag', ['fun'])

        const res = await request(app)
            .get('/api/v1/transactions/filter')
            .query({ startDate: '2026-01-01', endDate: '2026-01-31', tags: 'bills' })
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data).toHaveLength(1)
        expect(res.body.data[0].title).toBe('In Range')
    })
})
