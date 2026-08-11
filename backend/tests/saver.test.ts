import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import { authHeader, registerUser } from './helpers'

describe('Saver', () => {
    it('adds saver amount using percentage calculation', async () => {
        const { token } = await registerUser(app)

        const res = await request(app)
            .post('/api/v1/saver/add')
            .set(authHeader(token))
            .send({ remainingBalance: 1000, percentage: 30 })

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data.data.saverAmount).toBe(300)
    })

    it('adds saver amount using custom amount', async () => {
        const { token } = await registerUser(app)

        const res = await request(app)
            .post('/api/v1/saver/add')
            .set(authHeader(token))
            .send({ remainingBalance: 1000, customAmount: 150 })

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data.data.saverAmount).toBe(150)
    })

    it('rejects withdraw when insufficient funds', async () => {
        const { token } = await registerUser(app)

        await request(app)
            .post('/api/v1/saver/add')
            .set(authHeader(token))
            .send({ remainingBalance: 100, customAmount: 50 })

        const res = await request(app)
            .post('/api/v1/saver/withdraw')
            .set(authHeader(token))
            .send({ amount: 100 })

        expect(res.status).toBe(400)
        expect(res.body.success).toBe(false)
        expect(res.body.message).toMatch(/insufficient funds/i)
    })
})
