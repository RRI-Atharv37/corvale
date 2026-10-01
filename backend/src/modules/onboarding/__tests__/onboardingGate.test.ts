import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'

import app from '@http/app'
import { Account } from '@modules/accounts'
import { Budget } from '@modules/budgets'
import { SavingsGoal } from '@modules/savings-goals'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { authHeader, registerUser, type RegisteredUser } from '@tests/helpers'
import {
    BILLING_STATES,
    disableBilling,
    enableBilling,
    seedTestPlans,
    setSubscription,
} from '@tests/billingHelpers'

const start = (token: string) => request(app).post('/api/v1/onboarding/start').set(authHeader(token))
const step = (token: string, name: string, body: Record<string, unknown> = {}) =>
    request(app).post(`/api/v1/onboarding/step/${name}`).set(authHeader(token)).send(body)

afterEach(() => {
    disableBilling()
})

describe('onboarding steps respect the read-only gate (SEC-89)', () => {
    let user: RegisteredUser

    beforeEach(async () => {
        enableBilling()
        await seedTestPlans()
        user = await registerUser(app)
        await setSubscription(user.userId, BILLING_STATES.active)
        await start(user.token)
    })

    it.each(['account', 'categories', 'budget', 'goal', 'tour'])(
        'POST /onboarding/step/%s is refused with 402 once the account is read-only',
        async (name) => {
            await setSubscription(user.userId, BILLING_STATES.trial_expired)

            const res = await step(user.token, name, {
                accountName: 'Main',
                accountType: 'checking',
                budgetName: 'Food',
                budgetAmount: 100,
                goalName: 'Trip',
                targetAmount: 500,
            })

            expect(res.status).toBe(402)
            expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.READ_ONLY)
        }
    )

    it('a read-only user cannot loop replay -> account -> budget -> goal to create records', async () => {
        await setSubscription(user.userId, BILLING_STATES.trial_expired)

        for (let round = 0; round < 2; round += 1) {
            const replay = await request(app).post('/api/v1/onboarding/replay').set(authHeader(user.token))
            expect(replay.status).toBe(200)

            for (const name of ['account', 'budget', 'goal']) {
                const res = await step(user.token, name, {
                    accountName: 'Main',
                    accountType: 'checking',
                    budgetName: 'Food',
                    budgetAmount: 100,
                    goalName: 'Trip',
                    targetAmount: 500,
                })
                expect(res.status).toBe(402)
            }
        }

        expect(await Account.countDocuments({ userId: user.userId })).toBe(0)
        expect(await Budget.countDocuments({ userId: user.userId })).toBe(0)
        expect(await SavingsGoal.countDocuments({ userId: user.userId })).toBe(0)
    })

    it('start, status, skip and replay keep working while read-only', async () => {
        await setSubscription(user.userId, BILLING_STATES.trial_expired)

        expect((await start(user.token)).status).toBe(200)
        expect((await request(app).get('/api/v1/onboarding/status').set(authHeader(user.token))).status).toBe(200)
        expect((await request(app).patch('/api/v1/onboarding/skip').set(authHeader(user.token))).status).toBe(200)
        expect((await request(app).post('/api/v1/onboarding/replay').set(authHeader(user.token))).status).toBe(200)
    })

    it('an active user still completes the wizard', async () => {
        const account = await step(user.token, 'account', {
            accountName: 'Main',
            accountType: 'checking',
            openingBalance: 250,
        })
        expect(account.status).toBe(200)
        expect(await Account.countDocuments({ userId: user.userId })).toBe(1)
    })
})

describe('onboarding input validation (SEC-89, BUG-77)', () => {
    let user: RegisteredUser

    beforeEach(async () => {
        user = await registerUser(app)
        await start(user.token)
    })

    const reachBudgetStep = async () => {
        expect(
            (await step(user.token, 'account', { accountName: 'Main', accountType: 'checking' })).status
        ).toBe(200)
        expect((await step(user.token, 'categories', { categoriesReviewed: true })).status).toBe(200)
    }

    it.each([['0x10'], ['1e3'], ['abc'], [true], [[]], [1e300]])(
        'rejects the opening balance %j with 400',
        async (openingBalance) => {
            const res = await step(user.token, 'account', {
                accountName: 'Main',
                accountType: 'checking',
                openingBalance,
            })

            expect(res.status).toBe(400)
            expect(await Account.countDocuments({ userId: user.userId })).toBe(0)
        }
    )

    it('rejects a malformed budget categoryId with 400, not 500', async () => {
        await reachBudgetStep()

        const res = await step(user.token, 'budget', {
            budgetName: 'Food',
            budgetAmount: 100,
            categoryId: 'not-an-object-id',
        })

        expect(res.status).toBe(400)
        expect(await Budget.countDocuments({ userId: user.userId })).toBe(0)
    })

    it('rejects a budget categoryId that does not exist', async () => {
        await reachBudgetStep()

        const res = await step(user.token, 'budget', {
            budgetName: 'Food',
            budgetAmount: 100,
            categoryId: new Types.ObjectId().toString(),
        })

        expect(res.status).toBe(404)
        expect(await Budget.countDocuments({ userId: user.userId })).toBe(0)
    })

    it('accepts a master category on the budget step', async () => {
        await reachBudgetStep()
        const categories = await request(app).get('/api/v1/categories').set(authHeader(user.token))
        const food = categories.body.data.masters.find((m: { name: string }) => m.name === 'Food')

        const res = await step(user.token, 'budget', {
            budgetName: 'Food',
            budgetAmount: 100,
            categoryId: food._id,
        })

        expect(res.status).toBe(200)
        expect(await Budget.countDocuments({ userId: user.userId })).toBe(1)
    })

    it('rejects an out-of-range budget amount and goal target with 400', async () => {
        await reachBudgetStep()

        const budget = await step(user.token, 'budget', { budgetName: 'Food', budgetAmount: 1e15 })
        expect(budget.status).toBe(400)

        const skipped = await step(user.token, 'budget', { skipped: true })
        expect(skipped.status).toBe(200)

        const goal = await step(user.token, 'goal', { goalName: 'Trip', targetAmount: '0x10' })
        expect(goal.status).toBe(400)
    })
})
