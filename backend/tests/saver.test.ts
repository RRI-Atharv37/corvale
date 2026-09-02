import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { authHeader, createPostedTransaction, registerUser } from './helpers'

describe('Saver', () => {
    it('adds saver amount using percentage calculation', async () => {
        const { token, userId } = await registerUser(app)
        await createPostedTransaction(userId, 'income', 1000)

        const res = await request(app)
            .post('/api/v1/saver/add')
            .set(authHeader(token))
            .send({ percentage: 30 })

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data.data.saverBalance).toBe(300)
        expect(res.body.data.data.spendableBalance).toBe(700)
        expect(res.body.data.data.netWorth).toBe(1000)
    })

    it('adds saver amount using custom amount', async () => {
        const { token, userId } = await registerUser(app)
        await createPostedTransaction(userId, 'income', 1000)

        const res = await request(app)
            .post('/api/v1/saver/add')
            .set(authHeader(token))
            .send({ customAmount: 150 })

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data.data.saverBalance).toBe(150)
        expect(res.body.data.data.spendableBalance).toBe(850)
    })

    it('rejects withdraw when insufficient funds', async () => {
        const { token, userId } = await registerUser(app)
        await createPostedTransaction(userId, 'income', 100)

        await request(app)
            .post('/api/v1/saver/add')
            .set(authHeader(token))
            .send({ customAmount: 50 })

        const res = await request(app)
            .post('/api/v1/saver/withdraw')
            .set(authHeader(token))
            .send({ amount: 100 })

        expect(res.status).toBe(400)
        expect(res.body.success).toBe(false)
        expect(res.body.message).toMatch(/insufficient funds/i)
    })

    it('rejects deposit exceeding server-derived spendable balance', async () => {
        const { token, userId } = await registerUser(app)
        await createPostedTransaction(userId, 'income', 100)

        const res = await request(app)
            .post('/api/v1/saver/add')
            .set(authHeader(token))
            .send({ customAmount: 200 })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/spendable balance/i)
    })

    it('ignores client-supplied remainingBalance and uses server totals', async () => {
        const { token, userId } = await registerUser(app)
        await createPostedTransaction(userId, 'income', 100)

        const res = await request(app)
            .post('/api/v1/saver/add')
            .set(authHeader(token))
            .send({ remainingBalance: 999999, customAmount: 500 })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/spendable balance/i)
    })

    it('returns derived balance summary from details endpoint', async () => {
        const { token, userId } = await registerUser(app)
        await createPostedTransaction(userId, 'income', 1000)

        await request(app)
            .post('/api/v1/saver/add')
            .set(authHeader(token))
            .send({ customAmount: 200 })

        const res = await request(app)
            .get('/api/v1/saver/details')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.data).toMatchObject({
            totalIncome: 1000,
            totalExpenses: 0,
            saverBalance: 200,
            spendableBalance: 800,
            netWorth: 1000,
            remainingBalance: 800,
            balanceSource: 'legacy',
            accountCount: 0,
        })
    })
})
