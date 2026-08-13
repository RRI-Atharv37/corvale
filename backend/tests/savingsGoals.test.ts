import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import SavingsGoal from '../models/SavingsGoal'
import { authHeader, seedUserDirectly } from './helpers'

async function createTestAccount(token: string, name = 'Savings', openingBalance = 5000) {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'savings', openingBalance })

    return res.body.data
}

async function createTestGoal(
    token: string,
    overrides: Record<string, unknown> = {}
) {
    return request(app)
        .post('/api/v1/savings-goals')
        .set(authHeader(token))
        .send({
            name: 'Emergency fund',
            targetAmount: 1000,
            ...overrides,
        })
}

describe('Savings goals - CRUD and ownership', () => {
    it('creates a savings goal with progress metrics', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-create@example.com' })

        const res = await createTestGoal(token, {
            name: 'Vacation',
            targetAmount: 2000,
            targetDate: '2026-12-31',
        })

        expect(res.status).toBe(201)
        expect(res.body.success).toBe(true)
        expect(res.body.data.name).toBe('Vacation')
        expect(res.body.data.targetAmount).toBe(2000)
        expect(res.body.data.currentAmount).toBe(0)
        expect(res.body.data.status).toBe('active')
        expect(res.body.data.progress).toMatchObject({
            currentAmount: 0,
            targetAmount: 2000,
            remaining: 2000,
            percentComplete: 0,
            isComplete: false,
        })
        expect(res.body.data.progress.requiredMonthlyContribution).toBeGreaterThan(0)
        expect(res.body.data.autoContribution.enabled).toBe(false)
    })

    it('creates a goal with linked account and auto-contribution settings', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-auto@example.com' })
        const account = await createTestAccount(token)

        const res = await createTestGoal(token, {
            name: 'New laptop',
            targetAmount: 1500,
            accountId: account._id,
            autoContribution: {
                enabled: true,
                amount: 100,
                interval: 'monthly',
                dayOfMonth: 15,
            },
        })

        expect(res.status).toBe(201)
        expect(res.body.data.accountId).toBe(account._id)
        expect(res.body.data.autoContribution).toMatchObject({
            enabled: true,
            amount: 100,
            interval: 'monthly',
            dayOfMonth: 15,
            isDue: true,
        })
    })

    it('lists only the authenticated user goals', async () => {
        const owner = await seedUserDirectly({ email: 'goal-list-owner@example.com' })
        const other = await seedUserDirectly({ email: 'goal-list-other@example.com' })

        await createTestGoal(owner.token, { name: 'Owner goal' })
        await createTestGoal(other.token, { name: 'Other goal' })

        const res = await request(app).get('/api/v1/savings-goals').set(authHeader(owner.token))

        expect(res.status).toBe(200)
        expect(res.body.data).toHaveLength(1)
        expect(res.body.data[0].name).toBe('Owner goal')
    })

    it('filters goals by status and includes archived when requested', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-filter@example.com' })

        const activeRes = await createTestGoal(token, { name: 'Active goal' })
        const completedRes = await createTestGoal(token, { name: 'Completed goal' })
        const archivedRes = await createTestGoal(token, { name: 'Archived goal' })

        await request(app)
            .post(`/api/v1/savings-goals/${completedRes.body.data._id}/complete`)
            .set(authHeader(token))

        await request(app)
            .delete(`/api/v1/savings-goals/${archivedRes.body.data._id}`)
            .set(authHeader(token))

        const activeList = await request(app)
            .get('/api/v1/savings-goals?status=active')
            .set(authHeader(token))

        expect(activeList.body.data).toHaveLength(1)
        expect(activeList.body.data[0].name).toBe('Active goal')

        const completedList = await request(app)
            .get('/api/v1/savings-goals?status=completed')
            .set(authHeader(token))

        expect(completedList.body.data).toHaveLength(1)
        expect(completedList.body.data[0].name).toBe('Completed goal')

        const defaultList = await request(app).get('/api/v1/savings-goals').set(authHeader(token))
        expect(defaultList.body.data).toHaveLength(2)

        const withArchived = await request(app)
            .get('/api/v1/savings-goals?includeArchived=true')
            .set(authHeader(token))

        expect(withArchived.body.data).toHaveLength(3)
    })

    it('gets a goal by id and dedicated progress endpoint', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-get@example.com' })
        const createRes = await createTestGoal(token, { targetAmount: 800 })
        const goalId = createRes.body.data._id

        const getRes = await request(app)
            .get(`/api/v1/savings-goals/${goalId}`)
            .set(authHeader(token))

        expect(getRes.status).toBe(200)
        expect(getRes.body.data._id).toBe(goalId)
        expect(getRes.body.data.progress.targetAmount).toBe(800)

        const progressRes = await request(app)
            .get(`/api/v1/savings-goals/${goalId}/progress`)
            .set(authHeader(token))

        expect(progressRes.status).toBe(200)
        expect(progressRes.body.data.targetAmount).toBe(800)
        expect(progressRes.body.data.currentAmount).toBe(0)
    })

    it('updates goal fields', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-update@example.com' })
        const account = await createTestAccount(token)
        const createRes = await createTestGoal(token)
        const goalId = createRes.body.data._id

        const res = await request(app)
            .put(`/api/v1/savings-goals/${goalId}`)
            .set(authHeader(token))
            .send({
                name: 'Updated goal',
                targetAmount: 1200,
                accountId: account._id,
                autoContribution: {
                    enabled: true,
                    amount: 50,
                    interval: 'weekly',
                },
            })

        expect(res.status).toBe(200)
        expect(res.body.data.name).toBe('Updated goal')
        expect(res.body.data.targetAmount).toBe(1200)
        expect(res.body.data.accountId).toBe(account._id)
        expect(res.body.data.autoContribution.enabled).toBe(true)
        expect(res.body.data.autoContribution.interval).toBe('weekly')
    })

    it('archives a goal via DELETE', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-archive@example.com' })
        const createRes = await createTestGoal(token)
        const goalId = createRes.body.data._id

        const archiveRes = await request(app)
            .delete(`/api/v1/savings-goals/${goalId}`)
            .set(authHeader(token))

        expect(archiveRes.status).toBe(200)
        expect(archiveRes.body.data.data.status).toBe('archived')
    })

    it('returns 403 when accessing another user goal', async () => {
        const owner = await seedUserDirectly({ email: 'goal-owner@example.com' })
        const other = await seedUserDirectly({ email: 'goal-other@example.com' })

        const createRes = await createTestGoal(owner.token)
        const goalId = createRes.body.data._id

        const getRes = await request(app)
            .get(`/api/v1/savings-goals/${goalId}`)
            .set(authHeader(other.token))

        expect(getRes.status).toBe(403)

        const updateRes = await request(app)
            .put(`/api/v1/savings-goals/${goalId}`)
            .set(authHeader(other.token))
            .send({ name: 'Hacked' })

        expect(updateRes.status).toBe(403)
    })

    it('rejects invalid account ids on create', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-invalid-account@example.com' })
        const other = await seedUserDirectly({ email: 'goal-invalid-account-other@example.com' })
        const otherAccount = await createTestAccount(other.token, 'Other account')

        const res = await createTestGoal(token, {
            accountId: otherAccount._id,
        })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/invalid or not owned/i)
    })

    it('rejects update on an archived goal', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-archived-update@example.com' })
        const createRes = await createTestGoal(token)
        const goalId = createRes.body.data._id

        await request(app).delete(`/api/v1/savings-goals/${goalId}`).set(authHeader(token))

        const res = await request(app)
            .put(`/api/v1/savings-goals/${goalId}`)
            .set(authHeader(token))
            .send({ name: 'Should fail' })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/archived/i)
    })

    it('rejects invalid goal amount', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-invalid-amount@example.com' })

        const res = await createTestGoal(token, { targetAmount: 0 })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/invalid goal amount/i)
    })
})

describe('Savings goals - progress calculations', () => {
    it('computes required monthly contribution from target date', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-required-monthly@example.com' })

        const res = await createTestGoal(token, {
            targetAmount: 1000,
            targetDate: '2026-12-31',
        })

        expect(res.body.data.progress.requiredMonthlyContribution).toBeGreaterThan(0)
        expect(res.body.data.progress.monthsRemaining).toBeGreaterThan(0)
    })

    it('updates progress after manual contributions', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-contrib-progress@example.com' })
        const createRes = await createTestGoal(token, { targetAmount: 500 })
        const goalId = createRes.body.data._id

        await request(app)
            .post(`/api/v1/savings-goals/${goalId}/contribute`)
            .set(authHeader(token))
            .send({ amount: 150 })

        const progressRes = await request(app)
            .get(`/api/v1/savings-goals/${goalId}/progress`)
            .set(authHeader(token))

        expect(progressRes.body.data.currentAmount).toBe(150)
        expect(progressRes.body.data.remaining).toBe(350)
        expect(progressRes.body.data.percentComplete).toBe(30)
        expect(progressRes.body.data.isComplete).toBe(false)
    })

    it('auto-completes goal when contributions reach target', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-auto-complete@example.com' })
        const createRes = await createTestGoal(token, { targetAmount: 300 })
        const goalId = createRes.body.data._id

        const contribRes = await request(app)
            .post(`/api/v1/savings-goals/${goalId}/contribute`)
            .set(authHeader(token))
            .send({ amount: 300 })

        expect(contribRes.body.data.data.goal.status).toBe('completed')
        expect(contribRes.body.data.data.goal.progress.isComplete).toBe(true)
        expect(contribRes.body.data.data.goal.progress.percentComplete).toBe(100)
    })

    it('reopens completed goal when target amount is increased', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-reopen@example.com' })
        const createRes = await createTestGoal(token, { targetAmount: 200 })
        const goalId = createRes.body.data._id

        await request(app)
            .post(`/api/v1/savings-goals/${goalId}/contribute`)
            .set(authHeader(token))
            .send({ amount: 200 })

        const updateRes = await request(app)
            .put(`/api/v1/savings-goals/${goalId}`)
            .set(authHeader(token))
            .send({ targetAmount: 500 })

        expect(updateRes.body.data.status).toBe('active')
        expect(updateRes.body.data.progress.isComplete).toBe(false)
        expect(updateRes.body.data.progress.remaining).toBe(300)
    })
})

describe('Savings goals - contributions and auto-contribute', () => {
    it('records manual contributions with optional note', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-manual-contrib@example.com' })
        const createRes = await createTestGoal(token, { targetAmount: 1000 })
        const goalId = createRes.body.data._id

        const res = await request(app)
            .post(`/api/v1/savings-goals/${goalId}/contribute`)
            .set(authHeader(token))
            .send({ amount: 75, note: 'Paycheck deposit' })

        expect(res.status).toBe(200)
        expect(res.body.data.data.contribution.amount).toBe(75)
        expect(res.body.data.data.contribution.type).toBe('manual')
        expect(res.body.data.data.contribution.note).toBe('Paycheck deposit')
        expect(res.body.data.data.goal.currentAmount).toBe(75)
    })

    it('returns contribution history sorted newest first', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-history@example.com' })
        const createRes = await createTestGoal(token, { targetAmount: 1000 })
        const goalId = createRes.body.data._id

        await request(app)
            .post(`/api/v1/savings-goals/${goalId}/contribute`)
            .set(authHeader(token))
            .send({ amount: 50, note: 'First' })

        await request(app)
            .post(`/api/v1/savings-goals/${goalId}/contribute`)
            .set(authHeader(token))
            .send({ amount: 25, note: 'Second' })

        const historyRes = await request(app)
            .get(`/api/v1/savings-goals/${goalId}/contributions`)
            .set(authHeader(token))

        expect(historyRes.status).toBe(200)
        expect(historyRes.body.data).toHaveLength(2)
        expect(historyRes.body.data[0].amount).toBe(25)
        expect(historyRes.body.data[1].amount).toBe(50)
    })

    it('processes automatic contribution when due', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-auto-due@example.com' })
        const createRes = await createTestGoal(token, {
            targetAmount: 1000,
            autoContribution: {
                enabled: true,
                amount: 100,
                interval: 'weekly',
            },
        })
        const goalId = createRes.body.data._id

        const firstRes = await request(app)
            .post(`/api/v1/savings-goals/${goalId}/auto-contribute`)
            .set(authHeader(token))

        expect(firstRes.status).toBe(200)
        expect(firstRes.body.data.data.contribution.type).toBe('automatic')
        expect(firstRes.body.data.data.contribution.amount).toBe(100)
        expect(firstRes.body.data.data.goal.currentAmount).toBe(100)

        const secondRes = await request(app)
            .post(`/api/v1/savings-goals/${goalId}/auto-contribute`)
            .set(authHeader(token))

        expect(secondRes.status).toBe(400)
        expect(secondRes.body.message).toMatch(/not due/i)
    })

    it('processes automatic contribution after interval elapses', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-auto-interval@example.com' })
        const createRes = await createTestGoal(token, {
            targetAmount: 1000,
            autoContribution: {
                enabled: true,
                amount: 50,
                interval: 'weekly',
            },
        })
        const goalId = createRes.body.data._id

        await request(app)
            .post(`/api/v1/savings-goals/${goalId}/auto-contribute`)
            .set(authHeader(token))

        const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
        await SavingsGoal.updateOne(
            { _id: goalId },
            { 'autoContribution.lastContributedAt': eightDaysAgo }
        )

        const res = await request(app)
            .post(`/api/v1/savings-goals/${goalId}/auto-contribute`)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.data.goal.currentAmount).toBe(100)
    })

    it('rejects auto-contribute when disabled', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-auto-disabled@example.com' })
        const createRes = await createTestGoal(token, { targetAmount: 500 })
        const goalId = createRes.body.data._id

        const res = await request(app)
            .post(`/api/v1/savings-goals/${goalId}/auto-contribute`)
            .set(authHeader(token))

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/not enabled/i)
    })

    it('rejects contributions on paused, completed, and archived goals', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-contrib-block@example.com' })

        const pausedRes = await createTestGoal(token, { name: 'Paused' })
        const pausedId = pausedRes.body.data._id
        await request(app)
            .post(`/api/v1/savings-goals/${pausedId}/pause`)
            .set(authHeader(token))

        const pausedContrib = await request(app)
            .post(`/api/v1/savings-goals/${pausedId}/contribute`)
            .set(authHeader(token))
            .send({ amount: 10 })

        expect(pausedContrib.status).toBe(400)
        expect(pausedContrib.body.message).toMatch(/paused/i)

        const completedRes = await createTestGoal(token, { name: 'Completed' })
        const completedId = completedRes.body.data._id
        await request(app)
            .post(`/api/v1/savings-goals/${completedId}/complete`)
            .set(authHeader(token))

        const completedContrib = await request(app)
            .post(`/api/v1/savings-goals/${completedId}/contribute`)
            .set(authHeader(token))
            .send({ amount: 10 })

        expect(completedContrib.status).toBe(400)
        expect(completedContrib.body.message).toMatch(/completed/i)

        const archivedRes = await createTestGoal(token, { name: 'Archived' })
        const archivedId = archivedRes.body.data._id
        await request(app)
            .delete(`/api/v1/savings-goals/${archivedId}`)
            .set(authHeader(token))

        const archivedContrib = await request(app)
            .post(`/api/v1/savings-goals/${archivedId}/contribute`)
            .set(authHeader(token))
            .send({ amount: 10 })

        expect(archivedContrib.status).toBe(400)
        expect(archivedContrib.body.message).toMatch(/archived/i)
    })
})

describe('Savings goals - state transitions', () => {
    it('pauses and resumes an active goal', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-pause-resume@example.com' })
        const createRes = await createTestGoal(token)
        const goalId = createRes.body.data._id

        const pauseRes = await request(app)
            .post(`/api/v1/savings-goals/${goalId}/pause`)
            .set(authHeader(token))

        expect(pauseRes.status).toBe(200)
        expect(pauseRes.body.data.status).toBe('paused')

        const resumeRes = await request(app)
            .post(`/api/v1/savings-goals/${goalId}/resume`)
            .set(authHeader(token))

        expect(resumeRes.status).toBe(200)
        expect(resumeRes.body.data.status).toBe('active')
    })

    it('marks a goal complete manually', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-complete@example.com' })
        const createRes = await createTestGoal(token)
        const goalId = createRes.body.data._id

        const res = await request(app)
            .post(`/api/v1/savings-goals/${goalId}/complete`)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.status).toBe('completed')
        expect(res.body.data.completedAt).toBeDefined()
    })

    it('rejects invalid pause and resume transitions', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-invalid-transitions@example.com' })
        const createRes = await createTestGoal(token)
        const goalId = createRes.body.data._id

        await request(app)
            .post(`/api/v1/savings-goals/${goalId}/pause`)
            .set(authHeader(token))

        const doublePause = await request(app)
            .post(`/api/v1/savings-goals/${goalId}/pause`)
            .set(authHeader(token))

        expect(doublePause.status).toBe(400)
        expect(doublePause.body.message).toMatch(/already paused/i)

        await request(app)
            .post(`/api/v1/savings-goals/${goalId}/resume`)
            .set(authHeader(token))

        const resumeActive = await request(app)
            .post(`/api/v1/savings-goals/${goalId}/resume`)
            .set(authHeader(token))

        expect(resumeActive.status).toBe(400)
        expect(resumeActive.body.message).toMatch(/not paused/i)
    })

    it('rejects pause on completed and archived goals', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-pause-block@example.com' })

        const completedRes = await createTestGoal(token, { name: 'Done' })
        const completedId = completedRes.body.data._id
        await request(app)
            .post(`/api/v1/savings-goals/${completedId}/complete`)
            .set(authHeader(token))

        const pauseCompleted = await request(app)
            .post(`/api/v1/savings-goals/${completedId}/pause`)
            .set(authHeader(token))

        expect(pauseCompleted.status).toBe(400)
        expect(pauseCompleted.body.message).toMatch(/invalid/i)

        const archivedRes = await createTestGoal(token, { name: 'Old' })
        const archivedId = archivedRes.body.data._id
        await request(app)
            .delete(`/api/v1/savings-goals/${archivedId}`)
            .set(authHeader(token))

        const pauseArchived = await request(app)
            .post(`/api/v1/savings-goals/${archivedId}/pause`)
            .set(authHeader(token))

        expect(pauseArchived.status).toBe(400)
        expect(pauseArchived.body.message).toMatch(/invalid/i)
    })

    it('rejects complete on already completed and archived goals', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-complete-block@example.com' })
        const createRes = await createTestGoal(token)
        const goalId = createRes.body.data._id

        await request(app)
            .post(`/api/v1/savings-goals/${goalId}/complete`)
            .set(authHeader(token))

        const doubleComplete = await request(app)
            .post(`/api/v1/savings-goals/${goalId}/complete`)
            .set(authHeader(token))

        expect(doubleComplete.status).toBe(400)
        expect(doubleComplete.body.message).toMatch(/already completed/i)

        const archivedRes = await createTestGoal(token, { name: 'Archived complete' })
        const archivedId = archivedRes.body.data._id
        await request(app)
            .delete(`/api/v1/savings-goals/${archivedId}`)
            .set(authHeader(token))

        const completeArchived = await request(app)
            .post(`/api/v1/savings-goals/${archivedId}/complete`)
            .set(authHeader(token))

        expect(completeArchived.status).toBe(400)
        expect(completeArchived.body.message).toMatch(/archived/i)
    })

    it('rejects double archive', async () => {
        const { token } = await seedUserDirectly({ email: 'goal-double-archive@example.com' })
        const createRes = await createTestGoal(token)
        const goalId = createRes.body.data._id

        await request(app)
            .delete(`/api/v1/savings-goals/${goalId}`)
            .set(authHeader(token))

        const secondArchive = await request(app)
            .delete(`/api/v1/savings-goals/${goalId}`)
            .set(authHeader(token))

        expect(secondArchive.status).toBe(400)
        expect(secondArchive.body.message).toMatch(/already archived/i)
    })
})

describe('savingsGoalUtils', () => {
    it('computes required monthly contribution from minor units', async () => {
        const {
            computeRequiredMonthlyContribution,
            computeMonthsRemaining,
        } = await import('../utils/savingsGoalUtils')

        const targetDate = new Date('2026-12-31T23:59:59.999Z')
        const now = new Date('2026-08-12T12:00:00.000Z')

        const months = computeMonthsRemaining(targetDate, now)
        expect(months).toBe(4)

        const required = computeRequiredMonthlyContribution(100000, 0, targetDate, now)
        expect(required).toBe(250)

        const noTarget = computeRequiredMonthlyContribution(100000, 50000, null, now)
        expect(noTarget).toBeNull()

        const met = computeRequiredMonthlyContribution(100000, 100000, targetDate, now)
        expect(met).toBe(0)
    })

    it('detects auto-contribution due state by interval', async () => {
        const { isAutoContributionDue } = await import('../utils/savingsGoalUtils')

        const now = new Date('2026-08-15T12:00:00.000Z')

        expect(
            isAutoContributionDue(
                { enabled: true, amount: 5000, interval: 'weekly' },
                'UTC',
                now
            )
        ).toBe(true)

        const lastWeek = new Date('2026-08-10T12:00:00.000Z')
        expect(
            isAutoContributionDue(
                { enabled: true, amount: 5000, interval: 'weekly', lastContributedAt: lastWeek },
                'UTC',
                now
            )
        ).toBe(false)

        const lastMonth = new Date('2026-07-01T12:00:00.000Z')
        expect(
            isAutoContributionDue(
                {
                    enabled: true,
                    amount: 5000,
                    interval: 'monthly',
                    lastContributedAt: lastMonth,
                },
                'UTC',
                now
            )
        ).toBe(true)

        expect(
            isAutoContributionDue(
                { enabled: false, amount: 5000, interval: 'monthly' },
                'UTC',
                now
            )
        ).toBe(false)
    })

    it('computes projected completion date from auto-contribution rate', async () => {
        const { computeProjectedCompletionDate } = await import('../utils/savingsGoalUtils')
        const { Types } = await import('mongoose')

        const goal = await SavingsGoal.create({
            userId: new Types.ObjectId(),
            name: 'Test projection',
            targetAmount: 100000,
            currentAmount: 25000,
            currency: 'USD',
            autoContribution: {
                enabled: true,
                amount: 25000,
                interval: 'monthly',
            },
        })

        const now = new Date('2026-08-12T12:00:00.000Z')
        const projected = await computeProjectedCompletionDate(goal, now)

        expect(projected).toBe('2026-11-12')
    })
})
