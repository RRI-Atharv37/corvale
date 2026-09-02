import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Account } from '@modules/accounts'
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

async function getIncomeMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const income = res.body.data.masters.find((m: { name: string }) => m.name === 'Income')
    if (!income) throw new Error('Income master category not found')
    return income._id
}

async function createTemplate(
    token: string,
    payload: Record<string, unknown>
) {
    return request(app)
        .post('/api/v1/transaction-templates')
        .set(authHeader(token))
        .send(payload)
}

describe('Transaction templates - CRUD and ownership', () => {
    it('creates an expense template', async () => {
        const { token } = await seedUserDirectly({ email: 'template-create@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const res = await createTemplate(token, {
            name: 'Morning Coffee',
            type: 'expense',
            amount: 5.5,
            accountId: account._id,
            categoryId,
            tags: ['coffee', 'daily'],
            description: 'Regular coffee run',
        })

        expect(res.status).toBe(201)
        expect(res.body.data.name).toBe('Morning Coffee')
        expect(res.body.data.type).toBe('expense')
        expect(res.body.data.amount).toBe(5.5)
        expect(res.body.data.accountId).toBe(account._id)
        expect(res.body.data.categoryId).toBe(categoryId)
        expect(res.body.data.tags.sort()).toEqual(['coffee', 'daily'])
        expect(res.body.data.description).toBe('Regular coffee run')
    })

    it('lists templates scoped to authenticated user', async () => {
        const owner = await seedUserDirectly({ email: 'template-owner@example.com' })
        const other = await createSecondUser(app)
        const ownerAccount = await createTestAccount(owner.token)
        const otherAccount = await createTestAccount(other.token)
        const ownerCategoryId = await getFoodMasterId(owner.token)
        const otherCategoryId = await getFoodMasterId(other.token)

        await createTemplate(owner.token, {
            name: 'Owner Template',
            type: 'expense',
            amount: 10,
            accountId: ownerAccount._id,
            categoryId: ownerCategoryId,
        })

        await createTemplate(other.token, {
            name: 'Other Template',
            type: 'expense',
            amount: 20,
            accountId: otherAccount._id,
            categoryId: otherCategoryId,
        })

        const res = await request(app)
            .get('/api/v1/transaction-templates')
            .set(authHeader(owner.token))

        expect(res.status).toBe(200)
        expect(res.body.data).toHaveLength(1)
        expect(res.body.data[0].name).toBe('Owner Template')
    })

    it('updates a template', async () => {
        const { token } = await seedUserDirectly({ email: 'template-update@example.com' })
        const account = await createTestAccount(token)
        const foodCategoryId = await getFoodMasterId(token)
        const incomeCategoryId = await getIncomeMasterId(token)

        const createRes = await createTemplate(token, {
            name: 'Old Name',
            type: 'expense',
            amount: 12,
            accountId: account._id,
            categoryId: foodCategoryId,
        })

        const templateId = createRes.body.data._id

        const res = await request(app)
            .put(`/api/v1/transaction-templates/${templateId}`)
            .set(authHeader(token))
            .send({
                name: 'Updated Name',
                type: 'income',
                amount: 100,
                categoryId: incomeCategoryId,
                tags: ['salary'],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.name).toBe('Updated Name')
        expect(res.body.data.type).toBe('income')
        expect(res.body.data.amount).toBe(100)
        expect(res.body.data.categoryId).toBe(incomeCategoryId)
        expect(res.body.data.tags).toEqual(['salary'])
    })

    it('deletes a template', async () => {
        const { token } = await seedUserDirectly({ email: 'template-delete@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const createRes = await createTemplate(token, {
            name: 'Temporary',
            type: 'expense',
            amount: 8,
            accountId: account._id,
            categoryId,
        })

        const templateId = createRes.body.data._id

        const deleteRes = await request(app)
            .delete(`/api/v1/transaction-templates/${templateId}`)
            .set(authHeader(token))

        expect(deleteRes.status).toBe(200)

        const getRes = await request(app)
            .get(`/api/v1/transaction-templates/${templateId}`)
            .set(authHeader(token))

        expect(getRes.status).toBe(404)
    })

    it('returns 403 when accessing another user template', async () => {
        const owner = await seedUserDirectly({ email: 'template-owner403@example.com' })
        const other = await createSecondUser(app)
        const account = await createTestAccount(owner.token)
        const categoryId = await getFoodMasterId(owner.token)

        const createRes = await createTemplate(owner.token, {
            name: 'Private Template',
            type: 'expense',
            amount: 15,
            accountId: account._id,
            categoryId,
        })

        const templateId = createRes.body.data._id

        const res = await request(app)
            .get(`/api/v1/transaction-templates/${templateId}`)
            .set(authHeader(other.token))

        expect(res.status).toBe(403)
    })
})

describe('Transaction templates - apply', () => {
    it('creates a posted transaction from a template and updates account balance', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'template-apply@example.com' })
        const account = await createTestAccount(token, 200)
        const categoryId = await getFoodMasterId(token)

        const createRes = await createTemplate(token, {
            name: 'Lunch',
            type: 'expense',
            amount: 15,
            accountId: account._id,
            categoryId,
            tags: ['food'],
            description: 'Work lunch',
        })

        const templateId = createRes.body.data._id

        const res = await request(app)
            .post(`/api/v1/transaction-templates/${templateId}/apply`)
            .set(authHeader(token))
            .send({ date: '2026-02-01T12:00:00.000Z' })

        expect(res.status).toBe(201)
        expect(res.body.data.title).toBe('Lunch')
        expect(res.body.data.type).toBe('expense')
        expect(res.body.data.amount).toBe(15)
        expect(res.body.data.status).toBe('posted')
        expect(res.body.data.tags).toEqual(['food'])
        expect(res.body.data.description).toBe('Work lunch')

        const stored = await Transaction.findOne({ userId, title: 'Lunch' })
        expect(stored?.amount).toBe(1500)

        const updatedAccount = await Account.findById(account._id)
        expect(updatedAccount?.currentBalance).toBe(185)
    })

    it('rejects apply with invalid date', async () => {
        const { token } = await seedUserDirectly({ email: 'template-apply-date@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const createRes = await createTemplate(token, {
            name: 'Snack',
            type: 'expense',
            amount: 3,
            accountId: account._id,
            categoryId,
        })

        const templateId = createRes.body.data._id

        const res = await request(app)
            .post(`/api/v1/transaction-templates/${templateId}/apply`)
            .set(authHeader(token))
            .send({ date: 'not-a-date' })

        expect(res.status).toBe(400)
    })
})
