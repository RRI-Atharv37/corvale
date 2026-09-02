import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { User } from '@modules/users'
import { authHeader, seedUserDirectly } from './helpers'

/**
 * Sprint 12.2 acceptance criteria for multi-currency display and exchange rates.
 *
 * Contract defined by these tests (implementation must satisfy):
 *   GET /api/v1/exchange-rates
 *     -> return all user-configured exchange rates
 *     -> rates keyed by currency pairs (e.g., 'EUR/USD')
 *
 *   POST /api/v1/exchange-rates
 *     -> set or update exchange rate for a currency pair
 *     -> validate rate is positive
 *     -> persist to user preferences
 *
 *   PATCH /api/v1/exchange-rates/:pair
 *     -> update exchange rate for specific pair
 *
 *   GET /api/v1/auth/user
 *     -> return exchangeRates map persisted on User
 *   PATCH /api/v1/auth/user
 *     -> update preferredCurrency (existing endpoint, reused for currency prefs)
 *
 *   GET /api/v1/dashboard (with conversion)
 *     -> net worth aggregated across multiple currencies
 *     -> balances converted to preferredCurrency using exchangeRates
 *
 *   GET /api/v1/accounts (with conversion)
 *     -> display converted balance in preferredCurrency
 *     -> show original amount and exchange rate applied
 */

async function createTestAccount(
    token: string,
    name = 'Checking',
    currency = 'USD',
    openingBalance = 1000
) {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'checking', currency, openingBalance })
    return res.body.data
}

describe('Exchange Rates - API endpoints', () => {
    it('requires authentication on GET /exchange-rates', async () => {
        const res = await request(app).get('/api/v1/exchange-rates')
        expect(res.status).toBe(401)
    })

    it('requires authentication on POST /exchange-rates', async () => {
        const res = await request(app)
            .post('/api/v1/exchange-rates')
            .send({ pair: 'EUR/USD', rate: 1.1 })
        expect(res.status).toBe(401)
    })

    it('returns empty object for user with no exchange rates set', async () => {
        const { token } = await seedUserDirectly({ email: 'fx-empty@example.com' })

        const res = await request(app).get('/api/v1/exchange-rates').set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data).toEqual({})
    })

    it('creates a new exchange rate', async () => {
        const { token } = await seedUserDirectly({ email: 'fx-create@example.com' })

        const res = await request(app)
            .post('/api/v1/exchange-rates')
            .set(authHeader(token))
            .send({
                pair: 'EUR/USD',
                rate: 1.1,
            })

        expect(res.status).toBe(201)
        expect(res.body.data.EUR_USD).toBe(1.1)
    })

    it('validates exchange rate is positive', async () => {
        const { token } = await seedUserDirectly({ email: 'fx-positive@example.com' })

        const res = await request(app)
            .post('/api/v1/exchange-rates')
            .set(authHeader(token))
            .send({
                pair: 'EUR/USD',
                rate: -1.1,
            })

        expect(res.status).toBe(400)
    })

    it('validates exchange rate is not zero', async () => {
        const { token } = await seedUserDirectly({ email: 'fx-zero@example.com' })

        const res = await request(app)
            .post('/api/v1/exchange-rates')
            .set(authHeader(token))
            .send({
                pair: 'EUR/USD',
                rate: 0,
            })

        expect(res.status).toBe(400)
    })

    it('updates an existing exchange rate', async () => {
        const { token } = await seedUserDirectly({ email: 'fx-update@example.com' })

        await request(app)
            .post('/api/v1/exchange-rates')
            .set(authHeader(token))
            .send({
                pair: 'EUR/USD',
                rate: 1.1,
            })

        const res = await request(app)
            .patch('/api/v1/exchange-rates/EUR_USD')
            .set(authHeader(token))
            .send({
                rate: 1.15,
            })

        expect(res.status).toBe(200)
        expect(res.body.data.EUR_USD).toBe(1.15)
    })

    it('retrieves all exchange rates for user', async () => {
        const { token } = await seedUserDirectly({ email: 'fx-retrieve@example.com' })

        await request(app)
            .post('/api/v1/exchange-rates')
            .set(authHeader(token))
            .send({
                pair: 'EUR/USD',
                rate: 1.1,
            })

        await request(app)
            .post('/api/v1/exchange-rates')
            .set(authHeader(token))
            .send({
                pair: 'GBP/USD',
                rate: 1.27,
            })

        const res = await request(app).get('/api/v1/exchange-rates').set(authHeader(token))

        expect(res.status).toBe(200)
        expect(Object.keys(res.body.data)).toHaveLength(2)
        expect(res.body.data.EUR_USD).toBe(1.1)
        expect(res.body.data.GBP_USD).toBe(1.27)
    })

    it('deletes an exchange rate', async () => {
        const { token } = await seedUserDirectly({ email: 'fx-delete@example.com' })

        await request(app)
            .post('/api/v1/exchange-rates')
            .set(authHeader(token))
            .send({
                pair: 'EUR/USD',
                rate: 1.1,
            })

        const res = await request(app)
            .delete('/api/v1/exchange-rates/EUR_USD')
            .set(authHeader(token))

        expect(res.status).toBe(200)

        const checkRes = await request(app).get('/api/v1/exchange-rates').set(authHeader(token))
        expect(checkRes.body.data).toEqual({})
    })
})

describe('Exchange Rates - User preferences persistence', () => {
    it('persists exchange rates on User model', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'fx-persist@example.com' })

        await request(app)
            .post('/api/v1/exchange-rates')
            .set(authHeader(token))
            .send({
                pair: 'EUR/USD',
                rate: 1.1,
            })

        const user = await User.findById(userId)
        expect(user?.exchangeRates).toBeDefined()
        expect(user?.exchangeRates?.EUR_USD).toBe(1.1)
    })

    it('retrieves exchangeRates from user preferences endpoint', async () => {
        const { token } = await seedUserDirectly({ email: 'fx-prefs@example.com' })

        await request(app)
            .post('/api/v1/exchange-rates')
            .set(authHeader(token))
            .send({
                pair: 'EUR/USD',
                rate: 1.1,
            })

        const res = await request(app).get('/api/v1/auth/user').set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.exchangeRates).toBeDefined()
        expect(res.body.data.exchangeRates.EUR_USD).toBe(1.1)
    })

    it('updates preferred currency on user', async () => {
        const { token } = await seedUserDirectly({ email: 'fx-currency@example.com' })

        const res = await request(app)
            .patch('/api/v1/auth/user')
            .set(authHeader(token))
            .send({
                preferredCurrency: 'EUR',
            })

        expect(res.status).toBe(200)
        expect(res.body.data.preferredCurrency).toBe('EUR')

        const user = await User.findOne()
        expect(user?.preferredCurrency).toBe('EUR')
    })
})

describe('Exchange Rates - Account display with conversion', () => {
    it('displays original balance and converted balance for multi-currency account', async () => {
        const { token } = await seedUserDirectly({ email: 'fx-acct-display@example.com' })

        await request(app)
            .post('/api/v1/exchange-rates')
            .set(authHeader(token))
            .send({
                pair: 'EUR/USD',
                rate: 1.1,
            })

        const accountEUR = await createTestAccount(token, 'Euro', 'EUR', 1000)

        const res = await request(app)
            .get(`/api/v1/accounts/${accountEUR._id}`)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.currentBalance).toBe(1000)
        expect(res.body.data.currency).toBe('EUR')
        expect(res.body.data.convertedBalance).toBeDefined()
    })

    it('applies exchange rate to convert balance', async () => {
        const { token } = await seedUserDirectly({ email: 'fx-acct-convert@example.com' })

        await request(app)
            .post('/api/v1/exchange-rates')
            .set(authHeader(token))
            .send({
                pair: 'EUR/USD',
                rate: 1.1,
            })

        const accountEUR = await createTestAccount(token, 'Euro', 'EUR', 1000)

        const res = await request(app)
            .get(`/api/v1/accounts/${accountEUR._id}`)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.convertedBalance).toBe(1100)
        expect(res.body.data.exchangeRateApplied).toBe(1.1)
    })

    it('lists all accounts with converted balances', async () => {
        const { token } = await seedUserDirectly({ email: 'fx-acct-list@example.com' })

        await request(app)
            .post('/api/v1/exchange-rates')
            .set(authHeader(token))
            .send({
                pair: 'EUR/USD',
                rate: 1.1,
            })

        await createTestAccount(token, 'USD Account', 'USD', 1000)
        await createTestAccount(token, 'EUR Account', 'EUR', 1000)

        const res = await request(app)
            .get('/api/v1/accounts')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data).toHaveLength(2)
        expect(res.body.data[0].convertedBalance).toBeDefined()
        expect(res.body.data[1].convertedBalance).toBeDefined()
    })
})

describe('Exchange Rates - Dashboard net worth with conversion', () => {
    it('calculates net worth across multiple currencies', async () => {
        const { token } = await seedUserDirectly({ email: 'fx-networth@example.com' })

        await request(app)
            .post('/api/v1/exchange-rates')
            .set(authHeader(token))
            .send({
                pair: 'EUR/USD',
                rate: 1.1,
            })

        await createTestAccount(token, 'USD Account', 'USD', 1000)
        await createTestAccount(token, 'EUR Account', 'EUR', 1000)

        const res = await request(app)
            .get('/api/v1/dashboard')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.netWorth).toBeDefined()
        expect(res.body.data.netWorth).toBe(2100)
    })

    it('converts net worth to preferred currency', async () => {
        const { token } = await seedUserDirectly({ email: 'fx-preferred@example.com' })

        await request(app)
            .patch('/api/v1/auth/user')
            .set(authHeader(token))
            .send({
                preferredCurrency: 'EUR',
            })

        await request(app)
            .post('/api/v1/exchange-rates')
            .set(authHeader(token))
            .send({
                pair: 'USD/EUR',
                rate: 0.91,
            })

        await createTestAccount(token, 'USD Account', 'USD', 1000)

        const res = await request(app)
            .get('/api/v1/dashboard')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.netWorthInPreferredCurrency).toBeDefined()
        expect(res.body.data.preferredCurrency).toBe('EUR')
    })

    it('handles missing exchange rates by using original currency', async () => {
        const { token } = await seedUserDirectly({ email: 'fx-missing-rate@example.com' })

        const accountEUR = await createTestAccount(token, 'EUR Account', 'EUR', 1000)

        const res = await request(app)
            .get('/api/v1/dashboard')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.netWorth).toBeDefined()
    })
})

describe('Exchange Rates - Isolation', () => {
    it('prevents user from viewing other user\'s exchange rates', async () => {
        const user1 = await seedUserDirectly({ email: 'fx-iso-user1@example.com' })
        const user2 = await seedUserDirectly({ email: 'fx-iso-user2@example.com' })

        await request(app)
            .post('/api/v1/exchange-rates')
            .set(authHeader(user1.token))
            .send({
                pair: 'EUR/USD',
                rate: 1.1,
            })

        const res = await request(app).get('/api/v1/exchange-rates').set(authHeader(user2.token))

        expect(res.status).toBe(200)
        expect(res.body.data).toEqual({})
    })

    it('prevents user from modifying other user\'s exchange rates', async () => {
        const user1 = await seedUserDirectly({ email: 'fx-iso-mod-1@example.com' })
        const user2 = await seedUserDirectly({ email: 'fx-iso-mod-2@example.com' })

        await request(app)
            .post('/api/v1/exchange-rates')
            .set(authHeader(user1.token))
            .send({
                pair: 'EUR/USD',
                rate: 1.1,
            })

        const res = await request(app)
            .patch('/api/v1/exchange-rates/EUR_USD')
            .set(authHeader(user2.token))
            .send({
                rate: 1.2,
            })

        expect(res.status).toBe(404)

        const checkRes = await request(app)
            .get('/api/v1/exchange-rates')
            .set(authHeader(user1.token))
        expect(checkRes.body.data.EUR_USD).toBe(1.1)
    })
})
