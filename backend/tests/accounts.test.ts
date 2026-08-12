import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import Account from '../models/Account'
import { authHeader, createSecondUser, registerUser } from './helpers'

describe('Accounts', () => {
    it('creates an account with server-derived current balance from opening balance', async () => {
        const { token } = await registerUser(app)

        const res = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({
                name: 'Main Checking',
                type: 'checking',
                currency: 'usd',
                openingBalance: 1500.5,
            })

        expect(res.status).toBe(201)
        expect(res.body.success).toBe(true)
        expect(res.body.data.name).toBe('Main Checking')
        expect(res.body.data.type).toBe('checking')
        expect(res.body.data.currency).toBe('USD')
        expect(res.body.data.openingBalance).toBe(1500.5)
        expect(res.body.data.currentBalance).toBe(1500.5)
        expect(res.body.data.isDefault).toBe(true)
        expect(res.body.data.isArchived).toBe(false)
    })

    it('rejects client-supplied currentBalance on create', async () => {
        const { token } = await registerUser(app)

        const res = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({
                name: 'Tampered Account',
                type: 'cash',
                openingBalance: 100,
                currentBalance: 99999,
            })

        expect(res.status).toBe(400)
        expect(res.body.success).toBe(false)
        expect(res.body.message).toMatch(/server-derived/i)
    })

    it('lists only the authenticated user accounts', async () => {
        const owner = await registerUser(app)
        const other = await createSecondUser(app)

        await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(owner.token))
            .send({ name: 'Owner Account', type: 'checking' })

        await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(other.token))
            .send({ name: 'Other Account', type: 'savings' })

        const res = await request(app).get('/api/v1/accounts').set(authHeader(owner.token))

        expect(res.status).toBe(200)
        expect(res.body.data).toHaveLength(1)
        expect(res.body.data[0].name).toBe('Owner Account')
    })

    it('renames an account via PUT', async () => {
        const { token } = await registerUser(app)

        const createRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Old Name', type: 'checking' })

        const accountId = createRes.body.data._id

        const res = await request(app)
            .put(`/api/v1/accounts/${accountId}`)
            .set(authHeader(token))
            .send({ name: 'New Name', type: 'savings' })

        expect(res.status).toBe(200)
        expect(res.body.data.name).toBe('New Name')
        expect(res.body.data.type).toBe('savings')
    })

    it('archives an account via DELETE and excludes it from default list', async () => {
        const { token } = await registerUser(app)

        const createRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'To Archive', type: 'cash' })

        const accountId = createRes.body.data._id

        const deleteRes = await request(app)
            .delete(`/api/v1/accounts/${accountId}`)
            .set(authHeader(token))

        expect(deleteRes.status).toBe(200)
        expect(deleteRes.body.data.data.isArchived).toBe(true)
        expect(deleteRes.body.data.data.isDefault).toBe(false)

        const listRes = await request(app).get('/api/v1/accounts').set(authHeader(token))

        expect(listRes.body.data).toHaveLength(0)

        const archivedListRes = await request(app)
            .get('/api/v1/accounts?includeArchived=true')
            .set(authHeader(token))

        expect(archivedListRes.body.data).toHaveLength(1)
        expect(archivedListRes.body.data[0].isArchived).toBe(true)
    })

    it('sets default account and unsets the previous default', async () => {
        const { token } = await registerUser(app)

        const firstRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'First', type: 'checking' })

        const secondRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Second', type: 'savings', isDefault: false })

        const firstId = firstRes.body.data._id
        const secondId = secondRes.body.data._id

        expect(firstRes.body.data.isDefault).toBe(true)
        expect(secondRes.body.data.isDefault).toBe(false)

        const setDefaultRes = await request(app)
            .put(`/api/v1/accounts/${secondId}`)
            .set(authHeader(token))
            .send({ isDefault: true })

        expect(setDefaultRes.status).toBe(200)
        expect(setDefaultRes.body.data.isDefault).toBe(true)

        const firstAccount = await Account.findById(firstId)
        const secondAccount = await Account.findById(secondId)

        expect(firstAccount?.isDefault).toBe(false)
        expect(secondAccount?.isDefault).toBe(true)
    })

    it('enforces one default account per user', async () => {
        const { token } = await registerUser(app)

        await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Default One', type: 'checking' })

        const secondRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Default Two', type: 'savings', isDefault: true })

        expect(secondRes.status).toBe(201)
        expect(secondRes.body.data.isDefault).toBe(true)

        const defaults = await Account.find({ userId: secondRes.body.data.userId, isDefault: true })
        expect(defaults).toHaveLength(1)
        expect(defaults[0].name).toBe('Default Two')
    })

    it('returns 403 when accessing another user account', async () => {
        const owner = await registerUser(app)
        const other = await createSecondUser(app)

        const account = await Account.create({
            userId: owner.userId,
            name: 'Owner Account',
            type: 'checking',
            currency: 'USD',
            openingBalance: 100,
            currentBalance: 100,
        })

        const res = await request(app)
            .get(`/api/v1/accounts/${account._id}`)
            .set(authHeader(other.token))

        expect(res.status).toBe(403)
        expect(res.body.success).toBe(false)
        expect(res.body.message).toMatch(/not authorized/i)
    })
})
