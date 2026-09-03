import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '@http/app'
import { User } from '@modules/users'
import { Account } from '@modules/accounts'
import { authHeader, registerUser } from '@tests/helpers'

/**
 * Sprint 12.3 acceptance criteria for new-user onboarding wizard.
 *
 * Contract defined by these tests (implementation must satisfy):
 *   POST /api/v1/onboarding/start
 *     -> initialize onboarding session
 *     -> track which steps user has completed
 *     -> return current step and progress
 *
 *   POST /api/v1/onboarding/step/:step
 *     -> advance through: account → categories → budget → goal → tour
 *     -> persist step completion on User
 *
 *   PATCH /api/v1/onboarding/skip
 *     -> mark onboarding as completed (skipped by user)
 *     -> set onboardingCompleted = true
 *
 *   GET /api/v1/onboarding/status
 *     -> return current step, completed, skipped, progress percentage
 *
 *   Onboarding flow specifics:
 *   - Step 1: Create first account (required)
 *   - Step 2: Select/review categories (required)
 *   - Step 3: Create budget (optional)
 *   - Step 4: Create savings goal (optional)
 *   - Step 5: Product tour (optional)
 *   - Show once after signup unless replayed from settings
 */

describe('Onboarding - Start and status', () => {
    it('requires authentication', async () => {
        const app = createApp()
        const res = await request(app).post('/api/v1/onboarding/start')
        expect(res.status).toBe(401)
    })

    it('initializes onboarding for new user', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        const res = await request(app)
            .post('/api/v1/onboarding/start')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.currentStep).toBe('account')
        expect(res.body.data.onboardingCompleted).toBe(false)
        expect(res.body.data.progressPercentage).toBeGreaterThanOrEqual(0)
    })

    it('returns existing onboarding status if already started', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        await request(app)
            .post('/api/v1/onboarding/start')
            .set(authHeader(token))

        const res = await request(app)
            .post('/api/v1/onboarding/start')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.currentStep).toBe('account')
    })

    it('retrieves onboarding status', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        await request(app)
            .post('/api/v1/onboarding/start')
            .set(authHeader(token))

        const res = await request(app)
            .get('/api/v1/onboarding/status')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.currentStep).toBeDefined()
        expect(res.body.data.onboardingCompleted).toBeDefined()
        expect(res.body.data.progressPercentage).toBeDefined()
        expect(res.body.data.stepsCompleted).toBeDefined()
    })

    it('returns 404 if onboarding not started', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        const res = await request(app)
            .get('/api/v1/onboarding/status')
            .set(authHeader(token))

        expect(res.status).toBe(404)
    })
})

describe('Onboarding - Step progression', () => {
    it('completes account creation step', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        await request(app)
            .post('/api/v1/onboarding/start')
            .set(authHeader(token))

        const res = await request(app)
            .post('/api/v1/onboarding/step/account')
            .set(authHeader(token))
            .send({
                accountName: 'My Checking',
                accountType: 'checking',
                openingBalance: 5000,
            })

        expect(res.status).toBe(200)
        expect(res.body.data.currentStep).toBe('categories')
        expect(res.body.data.stepsCompleted).toContain('account')
    })

    it('requires account data for account step', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        await request(app)
            .post('/api/v1/onboarding/start')
            .set(authHeader(token))

        const res = await request(app)
            .post('/api/v1/onboarding/step/account')
            .set(authHeader(token))
            .send({})

        expect(res.status).toBe(400)
    })

    it('creates account during onboarding', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        await request(app)
            .post('/api/v1/onboarding/start')
            .set(authHeader(token))

        const res = await request(app)
            .post('/api/v1/onboarding/step/account')
            .set(authHeader(token))
            .send({
                accountName: 'My Checking',
                accountType: 'checking',
                openingBalance: 5000,
            })

        expect(res.status).toBe(200)
        expect(res.body.data.accountCreated).toBe(true)
        expect(res.body.data.accountId).toBeDefined()
    })

    it('defaults the onboarding account openingBalanceDate to today (start of day UTC)', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        await request(app).post('/api/v1/onboarding/start').set(authHeader(token))

        const res = await request(app)
            .post('/api/v1/onboarding/step/account')
            .set(authHeader(token))
            .send({ accountName: 'My Checking', accountType: 'checking', openingBalance: 5000 })

        const account = await Account.findById(res.body.data.accountId)
        const now = new Date()
        const expected = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
        )
        expect(account?.openingBalanceDate?.toISOString()).toBe(expected.toISOString())
    })

    it('honors an explicit openingBalanceDate during onboarding', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        await request(app).post('/api/v1/onboarding/start').set(authHeader(token))

        const res = await request(app)
            .post('/api/v1/onboarding/step/account')
            .set(authHeader(token))
            .send({
                accountName: 'Full History',
                accountType: 'checking',
                openingBalance: 0,
                openingBalanceDate: '2020-01-01T00:00:00.000Z',
            })

        const account = await Account.findById(res.body.data.accountId)
        expect(account?.openingBalanceDate?.toISOString()).toBe('2020-01-01T00:00:00.000Z')
    })

    it('completes categories step', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        await request(app)
            .post('/api/v1/onboarding/start')
            .set(authHeader(token))

        await request(app)
            .post('/api/v1/onboarding/step/account')
            .set(authHeader(token))
            .send({
                accountName: 'My Checking',
                accountType: 'checking',
                openingBalance: 5000,
            })

        const res = await request(app)
            .post('/api/v1/onboarding/step/categories')
            .set(authHeader(token))
            .send({
                categoriesReviewed: true,
            })

        expect(res.status).toBe(200)
        expect(res.body.data.currentStep).toBe('budget')
        expect(res.body.data.stepsCompleted).toContain('categories')
    })

    it('skips optional budget step', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        await request(app)
            .post('/api/v1/onboarding/start')
            .set(authHeader(token))

        await request(app)
            .post('/api/v1/onboarding/step/account')
            .set(authHeader(token))
            .send({
                accountName: 'My Checking',
                accountType: 'checking',
                openingBalance: 5000,
            })

        await request(app)
            .post('/api/v1/onboarding/step/categories')
            .set(authHeader(token))
            .send({
                categoriesReviewed: true,
            })

        const res = await request(app)
            .post('/api/v1/onboarding/step/budget')
            .set(authHeader(token))
            .send({
                skipped: true,
            })

        expect(res.status).toBe(200)
        expect(res.body.data.currentStep).toBe('goal')
    })

    it('creates budget during onboarding', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        await request(app)
            .post('/api/v1/onboarding/start')
            .set(authHeader(token))

        await request(app)
            .post('/api/v1/onboarding/step/account')
            .set(authHeader(token))
            .send({
                accountName: 'My Checking',
                accountType: 'checking',
                openingBalance: 5000,
            })

        await request(app)
            .post('/api/v1/onboarding/step/categories')
            .set(authHeader(token))
            .send({
                categoriesReviewed: true,
            })

        const res = await request(app)
            .post('/api/v1/onboarding/step/budget')
            .set(authHeader(token))
            .send({
                budgetName: 'Monthly Budget',
                budgetAmount: 2000,
                categoryId: '123456789012345678901234',
            })

        expect(res.status).toBe(200)
        expect(res.body.data.budgetCreated).toBe(true)
    })

    it('skips optional goal step', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        await request(app)
            .post('/api/v1/onboarding/start')
            .set(authHeader(token))

        await request(app)
            .post('/api/v1/onboarding/step/account')
            .set(authHeader(token))
            .send({
                accountName: 'My Checking',
                accountType: 'checking',
                openingBalance: 5000,
            })

        await request(app)
            .post('/api/v1/onboarding/step/categories')
            .set(authHeader(token))
            .send({
                categoriesReviewed: true,
            })

        await request(app)
            .post('/api/v1/onboarding/step/budget')
            .set(authHeader(token))
            .send({
                skipped: true,
            })

        const res = await request(app)
            .post('/api/v1/onboarding/step/goal')
            .set(authHeader(token))
            .send({
                skipped: true,
            })

        expect(res.status).toBe(200)
        expect(res.body.data.currentStep).toBe('tour')
    })

    it('creates savings goal during onboarding', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        await request(app)
            .post('/api/v1/onboarding/start')
            .set(authHeader(token))

        await request(app)
            .post('/api/v1/onboarding/step/account')
            .set(authHeader(token))
            .send({
                accountName: 'My Checking',
                accountType: 'checking',
                openingBalance: 5000,
            })

        await request(app)
            .post('/api/v1/onboarding/step/categories')
            .set(authHeader(token))
            .send({
                categoriesReviewed: true,
            })

        await request(app)
            .post('/api/v1/onboarding/step/budget')
            .set(authHeader(token))
            .send({
                skipped: true,
            })

        const res = await request(app)
            .post('/api/v1/onboarding/step/goal')
            .set(authHeader(token))
            .send({
                goalName: 'Emergency Fund',
                targetAmount: 10000,
            })

        expect(res.status).toBe(200)
        expect(res.body.data.goalCreated).toBe(true)
    })

    it('completes tour step and onboarding', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        await request(app)
            .post('/api/v1/onboarding/start')
            .set(authHeader(token))

        await request(app)
            .post('/api/v1/onboarding/step/account')
            .set(authHeader(token))
            .send({
                accountName: 'My Checking',
                accountType: 'checking',
                openingBalance: 5000,
            })

        await request(app)
            .post('/api/v1/onboarding/step/categories')
            .set(authHeader(token))
            .send({
                categoriesReviewed: true,
            })

        await request(app)
            .post('/api/v1/onboarding/step/budget')
            .set(authHeader(token))
            .send({
                skipped: true,
            })

        await request(app)
            .post('/api/v1/onboarding/step/goal')
            .set(authHeader(token))
            .send({
                skipped: true,
            })

        const res = await request(app)
            .post('/api/v1/onboarding/step/tour')
            .set(authHeader(token))
            .send({
                tourCompleted: true,
            })

        expect(res.status).toBe(200)
        expect(res.body.data.onboardingCompleted).toBe(true)
        expect(res.body.data.progressPercentage).toBe(100)
    })
})

describe('Onboarding - Skip and restart', () => {
    it('skips entire onboarding flow', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        await request(app)
            .post('/api/v1/onboarding/start')
            .set(authHeader(token))

        const res = await request(app)
            .patch('/api/v1/onboarding/skip')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.onboardingCompleted).toBe(true)
        expect(res.body.data.onboardingSkipped).toBe(true)
    })

    it('cannot skip onboarding without starting it', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        const res = await request(app)
            .patch('/api/v1/onboarding/skip')
            .set(authHeader(token))

        expect(res.status).toBe(404)
    })

    it('allows replay of onboarding from settings', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        await request(app)
            .post('/api/v1/onboarding/start')
            .set(authHeader(token))

        await request(app)
            .patch('/api/v1/onboarding/skip')
            .set(authHeader(token))

        const res = await request(app)
            .post('/api/v1/onboarding/replay')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.currentStep).toBe('account')
        expect(res.body.data.onboardingCompleted).toBe(false)
    })
})

describe('Onboarding - Progress tracking', () => {
    it('tracks progress percentage through steps', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        const startRes = await request(app)
            .post('/api/v1/onboarding/start')
            .set(authHeader(token))

        expect(startRes.body.data.progressPercentage).toBe(0)

        await request(app)
            .post('/api/v1/onboarding/step/account')
            .set(authHeader(token))
            .send({
                accountName: 'My Checking',
                accountType: 'checking',
                openingBalance: 5000,
            })

        const progressRes = await request(app)
            .get('/api/v1/onboarding/status')
            .set(authHeader(token))

        expect(progressRes.body.data.progressPercentage).toBeGreaterThan(0)
        expect(progressRes.body.data.progressPercentage).toBeLessThan(100)
    })

    it('persists onboarding status on User model', async () => {
        const app = createApp()
        const { token, userId } = await registerUser(app)

        await request(app)
            .post('/api/v1/onboarding/start')
            .set(authHeader(token))

        await request(app)
            .post('/api/v1/onboarding/step/account')
            .set(authHeader(token))
            .send({
                accountName: 'My Checking',
                accountType: 'checking',
                openingBalance: 5000,
            })

        const user = await User.findById(userId)
        expect(user?.onboardingStarted).toBe(true)
        expect(user?.onboardingCurrentStep).toBe('categories')
        expect(user?.onboardingStepsCompleted).toContain('account')
    })

    it('tracks completed steps', async () => {
        const app = createApp()
        const { token } = await registerUser(app)

        await request(app)
            .post('/api/v1/onboarding/start')
            .set(authHeader(token))

        await request(app)
            .post('/api/v1/onboarding/step/account')
            .set(authHeader(token))
            .send({
                accountName: 'My Checking',
                accountType: 'checking',
                openingBalance: 5000,
            })

        const res = await request(app)
            .get('/api/v1/onboarding/status')
            .set(authHeader(token))

        expect(res.body.data.stepsCompleted).toContain('account')
        expect(res.body.data.stepsCompleted).toHaveLength(1)
    })
})

describe('Onboarding - Isolation', () => {
    it('prevents unauthorized access to another user\'s onboarding', async () => {
        const app = createApp()
        const user1 = await registerUser(app)
        const user2 = await registerUser(app, { email: 'user2@example.com' })

        await request(app)
            .post('/api/v1/onboarding/start')
            .set(authHeader(user1.token))

        const res = await request(app)
            .get('/api/v1/onboarding/status')
            .set(authHeader(user2.token))

        expect(res.status).toBe(404)
    })

    it('isolates onboarding progress between users', async () => {
        const app = createApp()
        const user1 = await registerUser(app)
        const user2 = await registerUser(app, { email: 'user2@example.com' })

        await request(app)
            .post('/api/v1/onboarding/start')
            .set(authHeader(user1.token))

        await request(app)
            .post('/api/v1/onboarding/start')
            .set(authHeader(user2.token))

        await request(app)
            .post('/api/v1/onboarding/step/account')
            .set(authHeader(user1.token))
            .send({
                accountName: 'User1 Account',
                accountType: 'checking',
                openingBalance: 5000,
            })

        const user2Status = await request(app)
            .get('/api/v1/onboarding/status')
            .set(authHeader(user2.token))

        expect(user2Status.body.data.stepsCompleted).toEqual([])
    })
})
