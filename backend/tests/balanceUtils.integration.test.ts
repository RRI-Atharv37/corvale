import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import { authHeader, createTestIncome, registerUser } from './helpers'

async function createTestAccount(
    token: string,
    overrides: {
        name?: string
        type?: string
        openingBalance?: number
    } = {}
) {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({
            name: overrides.name ?? 'Test Account',
            type: overrides.type ?? 'checking',
            openingBalance: overrides.openingBalance ?? 0,
        })

    return res.body.data
}

describe('Account-primary balances', () => {
    it('uses legacy formulas when user has no accounts', async () => {
        const { token } = await registerUser(app)
        await createTestIncome(app, token, 1000)

        const res = await request(app)
            .get('/api/v1/saver/details')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.data).toMatchObject({
            totalIncome: 1000,
            totalExpenses: 0,
            netWorth: 1000,
            spendableBalance: 1000,
            balanceSource: 'legacy',
            accountCount: 0,
        })
    })

    it('derives net worth and spendable from account balances when accounts exist', async () => {
        const { token } = await registerUser(app)
        await createTestIncome(app, token, 5000)
        await createTestAccount(token, { name: 'Checking', type: 'checking', openingBalance: 3000 })
        await createTestAccount(token, { name: 'Savings', type: 'savings', openingBalance: 2000 })

        const res = await request(app)
            .get('/api/v1/saver/details')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.data).toMatchObject({
            totalIncome: 5000,
            totalExpenses: 0,
            netWorth: 5000,
            spendableBalance: 3000,
            totalAccountBalance: 5000,
            liquidBalance: 3000,
            accountCount: 2,
            balanceSource: 'accounts',
        })
    })

    it('subtracts credit account balances from net worth', async () => {
        const { token } = await registerUser(app)
        await createTestAccount(token, { name: 'Checking', type: 'checking', openingBalance: 5000 })
        await createTestAccount(token, { name: 'Credit Card', type: 'credit', openingBalance: 800 })

        const res = await request(app)
            .get('/api/v1/saver/details')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.data).toMatchObject({
            netWorth: 4200,
            spendableBalance: 5000,
            totalAccountBalance: 4200,
            liquidBalance: 5000,
            balanceSource: 'accounts',
        })
    })

    it('limits saver deposits to account-based spendable balance, not income totals', async () => {
        const { token } = await registerUser(app)
        await createTestIncome(app, token, 10000)
        await createTestAccount(token, { name: 'Checking', type: 'checking', openingBalance: 500 })

        const res = await request(app)
            .post('/api/v1/saver/add')
            .set(authHeader(token))
            .send({ customAmount: 600 })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/spendable balance/i)
    })

    it('allows saver deposit up to liquid account balance', async () => {
        const { token } = await registerUser(app)
        await createTestAccount(token, { name: 'Checking', type: 'checking', openingBalance: 1000 })

        const res = await request(app)
            .post('/api/v1/saver/add')
            .set(authHeader(token))
            .send({ customAmount: 300 })

        expect(res.status).toBe(200)
        expect(res.body.data.data).toMatchObject({
            saverBalance: 300,
            spendableBalance: 700,
            netWorth: 1000,
            balanceSource: 'accounts',
        })
    })
})
