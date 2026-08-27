import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import Account from '../models/Account'
import Budget from '../models/Budget'
import RecurringRule from '../models/RecurringRule'
import SavingsGoal from '../models/SavingsGoal'
import Transaction from '../models/Transaction'
import { authHeader, registerUser } from './helpers'

async function getIncomeMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const income = res.body.data.masters.find((m: { name: string }) => m.name === 'Income')
    if (!income) {
        throw new Error('Income master category not found')
    }
    return income._id
}

describe('User preferences', () => {
    it('syncs currency across all user records when preferred currency changes', async () => {
        const { token, userId } = await registerUser(app, {
            email: 'currency-sync@example.com',
        })

        const accountRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Checking', type: 'checking', currency: 'USD' })

        const accountId = accountRes.body.data._id
        const categoryId = await getIncomeMasterId(token)

        await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(token))
            .send({
                type: 'income',
                title: 'Paycheck',
                amount: 100,
                date: '2026-01-15T12:00:00.000Z',
                accountId,
                categoryId,
            })

        await request(app)
            .post('/api/v1/budgets')
            .set(authHeader(token))
            .send({
                periodType: 'monthly',
                periodStart: '2026-01-01',
                periodEnd: '2026-01-31',
                amount: 500,
                currency: 'USD',
                accountIds: [accountId],
            })

        await request(app)
            .post('/api/v1/savings-goals')
            .set(authHeader(token))
            .send({
                name: 'Emergency Fund',
                targetAmount: 1000,
                currency: 'USD',
            })

        await request(app)
            .post('/api/v1/recurring-rules')
            .set(authHeader(token))
            .send({
                title: 'Rent',
                type: 'expense',
                amount: 800,
                currency: 'USD',
                accountId,
                categoryId,
                interval: 'monthly',
                nextDueDate: '2026-02-01T12:00:00.000Z',
            })

        const updateRes = await request(app)
            .patch('/api/v1/auth/user')
            .set(authHeader(token))
            .send({ preferredCurrency: 'EUR' })

        expect(updateRes.status).toBe(200)
        expect(updateRes.body.data.preferredCurrency).toBe('EUR')

        const [accounts, transactions, budgets, goals, rules] = await Promise.all([
            Account.find({ userId }),
            Transaction.find({ userId }),
            Budget.find({ userId }),
            SavingsGoal.find({ userId }),
            RecurringRule.find({ userId }),
        ])

        expect(accounts.every((record) => record.currency === 'EUR')).toBe(true)
        expect(transactions.every((record) => record.currency === 'EUR')).toBe(true)
        expect(budgets.every((record) => record.currency === 'EUR')).toBe(true)
        expect(goals.every((record) => record.currency === 'EUR')).toBe(true)
        expect(rules.every((record) => record.currency === 'EUR')).toBe(true)
    })

    it('does not sync records when preferred currency is unchanged', async () => {
        const { token, userId } = await registerUser(app, {
            email: 'currency-no-sync@example.com',
        })

        await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Checking', type: 'checking', currency: 'USD' })

        await request(app)
            .patch('/api/v1/auth/user')
            .set(authHeader(token))
            .send({ preferredCurrency: 'USD' })

        const accounts = await Account.find({ userId })
        expect(accounts).toHaveLength(1)
        expect(accounts[0]?.currency).toBe('USD')
    })

    it('updates date format and page size preferences', async () => {
        const { token } = await registerUser(app, {
            email: 'display-prefs@example.com',
        })

        const updateRes = await request(app)
            .patch('/api/v1/auth/user')
            .set(authHeader(token))
            .send({ dateFormat: 'dd/mm/yy', pageSize: 25 })

        expect(updateRes.status).toBe(200)
        expect(updateRes.body.data.dateFormat).toBe('dd/mm/yy')
        expect(updateRes.body.data.pageSize).toBe(25)
    })

    it('rejects invalid date format and page size values', async () => {
        const { token } = await registerUser(app, {
            email: 'invalid-display-prefs@example.com',
        })

        const badDateFormat = await request(app)
            .patch('/api/v1/auth/user')
            .set(authHeader(token))
            .send({ dateFormat: 'mm-dd-yyyy' })

        expect(badDateFormat.status).toBe(400)

        const badPageSize = await request(app)
            .patch('/api/v1/auth/user')
            .set(authHeader(token))
            .send({ pageSize: 100 })

        expect(badPageSize.status).toBe(400)
    })

    it('updates full name and timezone', async () => {
        const { token } = await registerUser(app, {
            email: 'profile-update@example.com',
        })

        const updateRes = await request(app)
            .patch('/api/v1/auth/user')
            .set(authHeader(token))
            .send({ fullName: 'New Name', timezone: 'America/New_York' })

        expect(updateRes.status).toBe(200)
        expect(updateRes.body.data.fullName).toBe('New Name')
        expect(updateRes.body.data.timezone).toBe('America/New_York')
    })

    it('trims whitespace around a full name update', async () => {
        const { token } = await registerUser(app, {
            email: 'profile-trim@example.com',
        })

        const updateRes = await request(app)
            .patch('/api/v1/auth/user')
            .set(authHeader(token))
            .send({ fullName: '  Spaced Name  ' })

        expect(updateRes.status).toBe(200)
        expect(updateRes.body.data.fullName).toBe('Spaced Name')
    })

    it('rejects an empty full name and an invalid timezone', async () => {
        const { token } = await registerUser(app, {
            email: 'invalid-profile-update@example.com',
        })

        const badName = await request(app)
            .patch('/api/v1/auth/user')
            .set(authHeader(token))
            .send({ fullName: '   ' })

        expect(badName.status).toBe(400)

        const badTimezone = await request(app)
            .patch('/api/v1/auth/user')
            .set(authHeader(token))
            .send({ timezone: 'Not/AZone' })

        expect(badTimezone.status).toBe(400)
    })

    // V5: the signup form auto-detects the device timezone and sends it in the register payload
    // (there is no dropdown any more). `registerUser` reads it where it previously ignored it.
    it('stores a valid auto-detected timezone from the signup payload', async () => {
        const res = await request(app).post('/api/v1/auth/register').send({
            fullName: 'Tz User',
            email: 'signup-tz@example.com',
            password: 'TestPassword123!',
            timezone: 'Asia/Kolkata',
        })

        expect(res.status).toBe(201)
        expect(res.body.data.user.timezone).toBe('Asia/Kolkata')
    })

    it('falls back to UTC when the signup timezone is missing or invalid, without failing signup', async () => {
        const missing = await request(app).post('/api/v1/auth/register').send({
            fullName: 'No Tz',
            email: 'signup-no-tz@example.com',
            password: 'TestPassword123!',
        })
        expect(missing.status).toBe(201)
        expect(missing.body.data.user.timezone).toBe('UTC')

        const invalid = await request(app).post('/api/v1/auth/register').send({
            fullName: 'Bad Tz',
            email: 'signup-bad-tz@example.com',
            password: 'TestPassword123!',
            timezone: 'Not/AZone',
        })
        expect(invalid.status).toBe(201)
        expect(invalid.body.data.user.timezone).toBe('UTC')
    })
})
