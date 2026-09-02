import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Transaction } from '@modules/transactions'
import { authHeader, createSecondUser, seedUserDirectly } from './helpers'

async function createTestAccount(token: string, openingBalance = 1000, name = 'Checking') {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'checking', openingBalance })
    return res.body.data
}

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const food = res.body.data.masters.find((m: { name: string }) => m.name === 'Food')
    if (!food) throw new Error('Food master category not found')
    return food._id
}

async function getTransportMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const transport = res.body.data.masters.find((m: { name: string }) => m.name === 'Transport')
    if (!transport) throw new Error('Transport master category not found')
    return transport._id
}

async function createRule(
    token: string,
    payload: Record<string, unknown>
) {
    return request(app)
        .post('/api/v1/categorization-rules')
        .set(authHeader(token))
        .send(payload)
}

async function createExpense(
    token: string,
    accountId: string,
    categoryId: string,
    title: string,
    amount: number,
    extra: Record<string, unknown> = {}
) {
    return request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({
            type: 'expense',
            title,
            amount,
            date: '2026-01-15T12:00:00.000Z',
            accountId,
            categoryId,
            ...extra,
        })
}

describe('Categorization rules - CRUD and ownership', () => {
    it('creates a description_contains rule', async () => {
        const { token } = await seedUserDirectly({ email: 'rule-create@example.com' })
        const categoryId = await getTransportMasterId(token)

        const res = await createRule(token, {
            name: 'Uber rides',
            matchType: 'description_contains',
            matchValue: 'uber',
            categoryId,
            tags: ['transport'],
            priority: 10,
        })

        expect(res.status).toBe(201)
        expect(res.body.data.name).toBe('Uber rides')
        expect(res.body.data.matchType).toBe('description_contains')
        expect(res.body.data.categoryId).toBe(categoryId)
        expect(res.body.data.tags).toEqual(['transport'])
        expect(res.body.data.priority).toBe(10)
    })

    it('lists rules scoped to authenticated user', async () => {
        const owner = await seedUserDirectly({ email: 'rule-owner@example.com' })
        const other = await createSecondUser(app)
        const ownerCategoryId = await getFoodMasterId(owner.token)
        const otherCategoryId = await getFoodMasterId(other.token)

        await createRule(owner.token, {
            name: 'Owner Rule',
            matchType: 'description_contains',
            matchValue: 'coffee',
            categoryId: ownerCategoryId,
        })

        await createRule(other.token, {
            name: 'Other Rule',
            matchType: 'description_contains',
            matchValue: 'tea',
            categoryId: otherCategoryId,
        })

        const res = await request(app)
            .get('/api/v1/categorization-rules')
            .set(authHeader(owner.token))

        expect(res.status).toBe(200)
        expect(res.body.data).toHaveLength(1)
        expect(res.body.data[0].name).toBe('Owner Rule')
    })

    it('returns 403 when accessing another user rule', async () => {
        const owner = await seedUserDirectly({ email: 'rule-owner403@example.com' })
        const other = await createSecondUser(app)
        const categoryId = await getFoodMasterId(owner.token)

        const createRes = await createRule(owner.token, {
            name: 'Private Rule',
            matchType: 'description_contains',
            matchValue: 'secret',
            categoryId,
        })

        const ruleId = createRes.body.data._id

        const res = await request(app)
            .get(`/api/v1/categorization-rules/${ruleId}`)
            .set(authHeader(other.token))

        expect(res.status).toBe(403)
    })

    it('deletes a categorization rule', async () => {
        const { token } = await seedUserDirectly({ email: 'rule-delete@example.com' })
        const categoryId = await getFoodMasterId(token)

        const createRes = await createRule(token, {
            name: 'To Delete',
            matchType: 'description_contains',
            matchValue: 'temp',
            categoryId,
        })

        const ruleId = createRes.body.data._id

        const deleteRes = await request(app)
            .delete(`/api/v1/categorization-rules/${ruleId}`)
            .set(authHeader(token))

        expect(deleteRes.status).toBe(200)

        const getRes = await request(app)
            .get(`/api/v1/categorization-rules/${ruleId}`)
            .set(authHeader(token))

        expect(getRes.status).toBe(404)
    })
})

describe('Categorization rules - apply on create', () => {
    it('applies matching rule category and tags on transaction create', async () => {
        const { token } = await seedUserDirectly({ email: 'rule-apply@example.com' })
        const account = await createTestAccount(token)
        const foodCategoryId = await getFoodMasterId(token)
        const transportCategoryId = await getTransportMasterId(token)

        await createRule(token, {
            name: 'Starbucks',
            matchType: 'description_contains',
            matchValue: 'starbucks',
            categoryId: transportCategoryId,
            tags: ['coffee'],
        })

        const res = await createExpense(token, account._id, foodCategoryId, 'Starbucks run', 6.5, {
            description: 'Morning Starbucks',
            tags: ['personal'],
        })

        expect(res.status).toBe(201)
        expect(res.body.data.categoryId).toBe(transportCategoryId)
        expect(res.body.data.tags.sort()).toEqual(['coffee', 'personal'])
    })

    it('applies highest-priority matching rule', async () => {
        const { token } = await seedUserDirectly({ email: 'rule-priority@example.com' })
        const account = await createTestAccount(token)
        const foodCategoryId = await getFoodMasterId(token)
        const transportCategoryId = await getTransportMasterId(token)

        await createRule(token, {
            name: 'Low priority',
            matchType: 'description_contains',
            matchValue: 'amazon',
            categoryId: foodCategoryId,
            priority: 1,
        })

        await createRule(token, {
            name: 'High priority',
            matchType: 'description_contains',
            matchValue: 'amazon',
            categoryId: transportCategoryId,
            priority: 100,
        })

        const res = await createExpense(token, account._id, foodCategoryId, 'Amazon purchase', 25)

        expect(res.status).toBe(201)
        expect(res.body.data.categoryId).toBe(transportCategoryId)
    })

    it('skips inactive rules on transaction create', async () => {
        const { token } = await seedUserDirectly({ email: 'rule-inactive@example.com' })
        const account = await createTestAccount(token)
        const foodCategoryId = await getFoodMasterId(token)
        const transportCategoryId = await getTransportMasterId(token)

        const createRes = await createRule(token, {
            name: 'Paused rule',
            matchType: 'description_contains',
            matchValue: 'netflix',
            categoryId: transportCategoryId,
            isActive: false,
        })

        await request(app)
            .put(`/api/v1/categorization-rules/${createRes.body.data._id}`)
            .set(authHeader(token))
            .send({ isActive: false })

        const res = await createExpense(token, account._id, foodCategoryId, 'Netflix', 15.99)

        expect(res.status).toBe(201)
        expect(res.body.data.categoryId).toBe(foodCategoryId)
    })
})

describe('Categorization rules - bulk apply and test', () => {
    it('bulk-applies rules to existing transactions', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'rule-bulk@example.com' })
        const account = await createTestAccount(token)
        const foodCategoryId = await getFoodMasterId(token)
        const transportCategoryId = await getTransportMasterId(token)

        await createExpense(token, account._id, foodCategoryId, 'Lyft ride', 18)
        await createExpense(token, account._id, foodCategoryId, 'Groceries', 42)

        await createRule(token, {
            name: 'Rideshare',
            matchType: 'description_contains',
            matchValue: 'lyft',
            categoryId: transportCategoryId,
            tags: ['rideshare'],
        })

        const res = await request(app)
            .post('/api/v1/categorization-rules/bulk-apply')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.updated).toBe(1)
        expect(res.body.data.skipped).toBe(1)

        const updated = await Transaction.findOne({ userId, title: 'Lyft ride' })
        expect(updated?.categoryId.toString()).toBe(transportCategoryId)
        expect(updated?.tags).toEqual(['rideshare'])
    })

    it('test endpoint previews a matching rule', async () => {
        const { token } = await seedUserDirectly({ email: 'rule-test@example.com' })
        const account = await createTestAccount(token)
        const transportCategoryId = await getTransportMasterId(token)

        await createRule(token, {
            name: 'Spotify',
            matchType: 'description_contains',
            matchValue: 'spotify',
            categoryId: transportCategoryId,
            tags: ['subscription'],
        })

        const res = await request(app)
            .post('/api/v1/categorization-rules/test')
            .set(authHeader(token))
            .send({
                title: 'Spotify Premium',
                amount: 9.99,
                accountId: account._id,
                type: 'expense',
            })

        expect(res.status).toBe(200)
        expect(res.body.data.matched).toBe(true)
        expect(res.body.data.ruleName).toBe('Spotify')
        expect(res.body.data.categoryId).toBe(transportCategoryId)
        expect(res.body.data.tags).toEqual(['subscription'])
    })

    it('test endpoint reports no match', async () => {
        const { token } = await seedUserDirectly({ email: 'rule-test-none@example.com' })
        const account = await createTestAccount(token)

        const res = await request(app)
            .post('/api/v1/categorization-rules/test')
            .set(authHeader(token))
            .send({
                title: 'Random purchase',
                amount: 5,
                accountId: account._id,
                type: 'expense',
            })

        expect(res.status).toBe(200)
        expect(res.body.data.matched).toBe(false)
    })
})
