import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Category } from '@modules/categories'
import { authHeader, createSecondUser, registerUser, seedUserDirectly } from './helpers'
import { MASTER_CATEGORY_DEFINITIONS } from "@modules/categories/categorySeed";

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const food = res.body.data.masters.find((m: { name: string }) => m.name === 'Food')
    if (!food) {
        throw new Error('Food master category not found')
    }
    return food._id
}

describe('Categories', () => {
    it('seeds master categories on first list request', async () => {
        const { token } = await registerUser(app)

        const res = await request(app).get('/api/v1/categories').set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.masters).toHaveLength(MASTER_CATEGORY_DEFINITIONS.length)
        expect(res.body.data.userCategories).toHaveLength(0)

        const names = res.body.data.masters.map((m: { name: string }) => m.name)
        expect(names).toContain('Food')
        expect(names).toContain('Income')
        expect(names).toContain('Other')
    })

    it('creates a sub-category under a master category', async () => {
        const { token } = await registerUser(app)
        const masterCategoryId = await getFoodMasterId(token)

        const res = await request(app)
            .post('/api/v1/categories')
            .set(authHeader(token))
            .send({
                masterCategoryId,
                name: 'Groceries',
                icon: 'shopping-cart',
                color: '#FF0000',
            })

        expect(res.status).toBe(201)
        expect(res.body.data.name).toBe('Groceries')
        expect(res.body.data.masterCategoryId).toBe(masterCategoryId)
        expect(res.body.data.icon).toBe('shopping-cart')
        expect(res.body.data.color).toBe('#FF0000')
        expect(res.body.data.isDefault).toBe(false)
        expect(res.body.data.isArchived).toBe(false)
        expect(res.body.data.sortOrder).toBe(0)
    })

    it('rejects duplicate sub-category names under the same master', async () => {
        const { token } = await registerUser(app)
        const masterCategoryId = await getFoodMasterId(token)

        await request(app)
            .post('/api/v1/categories')
            .set(authHeader(token))
            .send({ masterCategoryId, name: 'Dining Out' })

        const res = await request(app)
            .post('/api/v1/categories')
            .set(authHeader(token))
            .send({ masterCategoryId, name: 'Dining Out' })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/already exists/i)
    })

    it('lists master and user categories scoped to authenticated user', async () => {
        const owner = await registerUser(app)
        const other = await createSecondUser(app)
        const masterCategoryId = await getFoodMasterId(owner.token)

        await request(app)
            .post('/api/v1/categories')
            .set(authHeader(owner.token))
            .send({ masterCategoryId, name: 'Owner Groceries' })

        await request(app)
            .post('/api/v1/categories')
            .set(authHeader(other.token))
            .send({ masterCategoryId, name: 'Other Groceries' })

        const res = await request(app).get('/api/v1/categories').set(authHeader(owner.token))

        expect(res.status).toBe(200)
        expect(res.body.data.masters).toHaveLength(MASTER_CATEGORY_DEFINITIONS.length)
        expect(res.body.data.userCategories).toHaveLength(1)
        expect(res.body.data.userCategories[0].name).toBe('Owner Groceries')
    })

    it('renames a sub-category via PUT', async () => {
        const { token } = await registerUser(app)
        const masterCategoryId = await getFoodMasterId(token)

        const createRes = await request(app)
            .post('/api/v1/categories')
            .set(authHeader(token))
            .send({ masterCategoryId, name: 'Old Name' })

        const categoryId = createRes.body.data._id

        const res = await request(app)
            .put(`/api/v1/categories/${categoryId}`)
            .set(authHeader(token))
            .send({ name: 'New Name', color: '#00FF00' })

        expect(res.status).toBe(200)
        expect(res.body.data.name).toBe('New Name')
        expect(res.body.data.color).toBe('#00FF00')
    })

    it('archives a sub-category via DELETE', async () => {
        const { token } = await registerUser(app)
        const masterCategoryId = await getFoodMasterId(token)

        const createRes = await request(app)
            .post('/api/v1/categories')
            .set(authHeader(token))
            .send({ masterCategoryId, name: 'To Archive' })

        const categoryId = createRes.body.data._id

        const deleteRes = await request(app)
            .delete(`/api/v1/categories/${categoryId}`)
            .set(authHeader(token))

        expect(deleteRes.status).toBe(200)
        expect(deleteRes.body.data.data.isArchived).toBe(true)
        expect(deleteRes.body.data.data.isDefault).toBe(false)

        const listRes = await request(app).get('/api/v1/categories').set(authHeader(token))
        expect(listRes.body.data.userCategories).toHaveLength(0)

        const archivedListRes = await request(app)
            .get('/api/v1/categories?includeArchived=true')
            .set(authHeader(token))

        expect(archivedListRes.body.data.userCategories).toHaveLength(1)
        expect(archivedListRes.body.data.userCategories[0].isArchived).toBe(true)
    })

    it('reorders user categories', async () => {
        const { token } = await registerUser(app)
        const masterCategoryId = await getFoodMasterId(token)

        const first = await request(app)
            .post('/api/v1/categories')
            .set(authHeader(token))
            .send({ masterCategoryId, name: 'First' })

        const second = await request(app)
            .post('/api/v1/categories')
            .set(authHeader(token))
            .send({ masterCategoryId, name: 'Second' })

        const firstId = first.body.data._id
        const secondId = second.body.data._id

        const res = await request(app)
            .put('/api/v1/categories/reorder')
            .set(authHeader(token))
            .send({ orderedIds: [secondId, firstId] })

        expect(res.status).toBe(200)
        expect(res.body.data[0]._id).toBe(secondId)
        expect(res.body.data[0].sortOrder).toBe(0)
        expect(res.body.data[1]._id).toBe(firstId)
        expect(res.body.data[1].sortOrder).toBe(1)
    })

    it('sets default category and unsets the previous default', async () => {
        const { token } = await registerUser(app)
        const masterCategoryId = await getFoodMasterId(token)

        const firstRes = await request(app)
            .post('/api/v1/categories')
            .set(authHeader(token))
            .send({ masterCategoryId, name: 'First', isDefault: true })

        const secondRes = await request(app)
            .post('/api/v1/categories')
            .set(authHeader(token))
            .send({ masterCategoryId, name: 'Second' })

        const firstId = firstRes.body.data._id
        const secondId = secondRes.body.data._id

        expect(firstRes.body.data.isDefault).toBe(true)

        const setDefaultRes = await request(app)
            .put(`/api/v1/categories/${secondId}`)
            .set(authHeader(token))
            .send({ isDefault: true })

        expect(setDefaultRes.status).toBe(200)
        expect(setDefaultRes.body.data.isDefault).toBe(true)

        const firstCategory = await Category.findById(firstId)
        const secondCategory = await Category.findById(secondId)

        expect(firstCategory?.isDefault).toBe(false)
        expect(secondCategory?.isDefault).toBe(true)
    })

    it('allows any authenticated user to read master categories by id', async () => {
        const owner = await seedUserDirectly({ email: 'owner-read@example.com' })
        const other = await seedUserDirectly({ email: 'other-read@example.com' })
        const masterCategoryId = await getFoodMasterId(owner.token)

        const res = await request(app)
            .get(`/api/v1/categories/${masterCategoryId}`)
            .set(authHeader(other.token))

        expect(res.status).toBe(200)
        expect(res.body.data.name).toBe('Food')
    })

    it('returns 403 when accessing another user sub-category', async () => {
        const owner = await seedUserDirectly({ email: 'owner-private@example.com' })
        const other = await seedUserDirectly({ email: 'other-private@example.com' })
        const masterCategoryId = await getFoodMasterId(owner.token)

        const createRes = await request(app)
            .post('/api/v1/categories')
            .set(authHeader(owner.token))
            .send({ masterCategoryId, name: 'Private' })

        const categoryId = createRes.body.data._id

        const res = await request(app)
            .get(`/api/v1/categories/${categoryId}`)
            .set(authHeader(other.token))

        expect(res.status).toBe(403)
        expect(res.body.message).toMatch(/not authorized/i)
    })

    it('returns 403 when modifying a master category', async () => {
        const { token } = await seedUserDirectly({ email: 'master-guard@example.com' })
        const masterCategoryId = await getFoodMasterId(token)

        const res = await request(app)
            .put(`/api/v1/categories/${masterCategoryId}`)
            .set(authHeader(token))
            .send({ name: 'Tampered Food' })

        expect(res.status).toBe(403)
        expect(res.body.message).toMatch(/master categories cannot be modified/i)
    })
})
