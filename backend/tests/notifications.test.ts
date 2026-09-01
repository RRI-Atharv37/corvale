import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import Notification from '../models/Notification'
import User from '../models/User'
import { authHeader, createSecondUser, seedUserDirectly } from './helpers'

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const food = res.body.data.masters.find((m: { name: string }) => m.name === 'Food')
    if (!food) {
        throw new Error('Food master category not found')
    }
    return food._id
}

async function createTestAccount(token: string, name = 'Checking', openingBalance = 1000) {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'checking', openingBalance })

    return res.body.data
}

async function createMonthlyBudget(token: string, overrides: Record<string, unknown> = {}) {
    return request(app)
        .post('/api/v1/budgets')
        .set(authHeader(token))
        .send({
            periodType: 'monthly',
            year: 2026,
            month: 1,
            amount: 500,
            ...overrides,
        })
}

async function createTestExpense(
    token: string,
    payload: {
        title: string
        amount: number
        date: string
        accountId: string
        categoryId: string
    }
) {
    return request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({ type: 'expense', ...payload })
}

async function createTestGoal(token: string, overrides: Record<string, unknown> = {}) {
    return request(app)
        .post('/api/v1/savings-goals')
        .set(authHeader(token))
        .send({
            name: 'Emergency fund',
            targetAmount: 100,
            ...overrides,
        })
}

async function createRecurringBill(
    token: string,
    nextDueDate: string,
    overrides: Record<string, unknown> = {}
) {
    const account = await createTestAccount(token)
    const categoryId = await getFoodMasterId(token)

    return request(app)
        .post('/api/v1/recurring-rules')
        .set(authHeader(token))
        .send({
            title: 'Electric bill',
            type: 'expense',
            amount: 85,
            accountId: account._id,
            categoryId,
            interval: 'monthly',
            nextDueDate,
            ...overrides,
        })
}

function todayDateStr(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date())
}

function addDaysToDateStr(dateStr: string, days: number): string {
    const [year, month, day] = dateStr.split('-').map(Number)
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

describe('Notifications - Phase 7.1', () => {
    it('returns an empty notification list for a new user', async () => {
        const { token } = await seedUserDirectly({ email: 'notifications-empty@example.com' })

        const res = await request(app).get('/api/v1/notifications').set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data.notifications).toEqual([])
        expect(res.body.data.unreadCount).toBe(0)
    })

    it('creates a budget over-limit notification when an expense exceeds the budget', async () => {
        const { token } = await seedUserDirectly({ email: 'notifications-budget@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        await createMonthlyBudget(token, {
            name: 'Food budget',
            amount: 100,
            categoryId,
        })

        const expenseRes = await createTestExpense(token, {
            title: 'Groceries',
            amount: 150,
            date: '2026-01-15T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        expect(expenseRes.status).toBe(201)

        const res = await request(app).get('/api/v1/notifications').set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.unreadCount).toBe(1)
        expect(res.body.data.notifications).toHaveLength(1)
        expect(res.body.data.notifications[0]).toMatchObject({
            type: 'budget_over_limit',
            title: 'Budget exceeded',
            referenceType: 'budget',
        })
        expect(res.body.data.notifications[0].message).toContain('Food budget')
    })

    it('formats the budget over-limit message in the budget currency, not hardcoded $', async () => {
        const { token } = await seedUserDirectly({ email: 'notifications-budget-eur@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        await createMonthlyBudget(token, {
            name: 'Food budget',
            amount: 100,
            currency: 'EUR',
            categoryId,
        })

        await createTestExpense(token, {
            title: 'Groceries',
            amount: 150,
            date: '2026-01-15T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        const res = await request(app).get('/api/v1/notifications').set(authHeader(token))

        expect(res.status).toBe(200)
        const message = res.body.data.notifications[0].message
        expect(message).toContain('€')
        expect(message).not.toContain('$')
        expect(res.body.data.notifications[0].metadata.currency).toBe('EUR')
    })

    it('formats the bill due message in the rule currency, not hardcoded $', async () => {
        const { token } = await seedUserDirectly({ email: 'notifications-bill-eur@example.com' })
        const dueDate = addDaysToDateStr(todayDateStr(), 2)

        await createRecurringBill(token, dueDate, { currency: 'EUR' })

        const res = await request(app).get('/api/v1/notifications').set(authHeader(token))

        expect(res.status).toBe(200)
        const message = res.body.data.notifications[0].message
        expect(message).toContain('€')
        expect(message).not.toContain('$')
        expect(res.body.data.notifications[0].metadata.currency).toBe('EUR')
    })

    it('dedupes budget over-limit notifications for the same budget period', async () => {
        const { token } = await seedUserDirectly({ email: 'notifications-budget-dedupe@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        await createMonthlyBudget(token, {
            name: 'Food budget',
            amount: 50,
            categoryId,
        })

        await createTestExpense(token, {
            title: 'First overspend',
            amount: 80,
            date: '2026-01-10T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        await createTestExpense(token, {
            title: 'Second overspend',
            amount: 40,
            date: '2026-01-12T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        const res = await request(app).get('/api/v1/notifications').set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.notifications).toHaveLength(1)
    })

    it('creates savings milestone notifications when contributions cross thresholds', async () => {
        const { token } = await seedUserDirectly({ email: 'notifications-milestone@example.com' })

        const goalRes = await createTestGoal(token, {
            name: 'Vacation',
            targetAmount: 100,
        })
        const goalId = goalRes.body.data._id

        const contributeRes = await request(app)
            .post(`/api/v1/savings-goals/${goalId}/contribute`)
            .set(authHeader(token))
            .send({ amount: 55 })

        expect(contributeRes.status).toBe(200)

        const res = await request(app).get('/api/v1/notifications').set(authHeader(token))

        expect(res.status).toBe(200)
        const types = res.body.data.notifications.map((entry: { type: string }) => entry.type)
        expect(types).toContain('savings_milestone')
        expect(res.body.data.notifications.some((entry: { title: string }) => entry.title.includes('50%'))).toBe(
            true
        )
    })

    it('syncs bill due reminders based on user preference window', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'notifications-bill@example.com' })
        const dueDate = addDaysToDateStr(todayDateStr(), 2)

        await createRecurringBill(token, dueDate)

        const res = await request(app).get('/api/v1/notifications').set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.notifications).toHaveLength(1)
        expect(res.body.data.notifications[0]).toMatchObject({
            type: 'bill_due',
            title: 'Upcoming bill',
            referenceType: 'recurring_rule',
        })
        expect(res.body.data.notifications[0].message).toContain('Electric bill')

        const stored = await Notification.find({ userId })
        expect(stored).toHaveLength(1)
    })

    it('skips bill due reminders when the user disables them', async () => {
        const { token } = await seedUserDirectly({ email: 'notifications-bill-off@example.com' })
        const dueDate = todayDateStr()

        await request(app)
            .patch('/api/v1/auth/user')
            .set(authHeader(token))
            .send({
                notificationPreferences: {
                    billRemindersEnabled: false,
                    billReminderDaysBefore: 3,
                },
            })

        await createRecurringBill(token, dueDate)

        const res = await request(app).get('/api/v1/notifications').set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.notifications).toHaveLength(0)
    })

    it('marks a notification as read', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'notifications-read@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        await createMonthlyBudget(token, { amount: 50, categoryId })
        await createTestExpense(token, {
            title: 'Overspend',
            amount: 75,
            date: '2026-01-08T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        const listRes = await request(app).get('/api/v1/notifications').set(authHeader(token))
        const notificationId = listRes.body.data.notifications[0]._id

        const readRes = await request(app)
            .patch(`/api/v1/notifications/${notificationId}/read`)
            .set(authHeader(token))

        expect(readRes.status).toBe(200)

        const refreshed = await Notification.findById(notificationId)
        expect(refreshed?.readAt).toBeTruthy()

        const listAgain = await request(app).get('/api/v1/notifications').set(authHeader(token))
        expect(listAgain.body.data.unreadCount).toBe(0)
    })

    it('dismisses a notification and hides it from the list', async () => {
        const { token } = await seedUserDirectly({ email: 'notifications-dismiss@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        await createMonthlyBudget(token, { amount: 50, categoryId })
        await createTestExpense(token, {
            title: 'Overspend',
            amount: 75,
            date: '2026-01-08T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        const listRes = await request(app).get('/api/v1/notifications').set(authHeader(token))
        const notificationId = listRes.body.data.notifications[0]._id

        const dismissRes = await request(app)
            .patch(`/api/v1/notifications/${notificationId}/dismiss`)
            .set(authHeader(token))

        expect(dismissRes.status).toBe(200)

        const listAgain = await request(app).get('/api/v1/notifications').set(authHeader(token))
        expect(listAgain.body.data.notifications).toHaveLength(0)
    })

    it('marks all notifications as read', async () => {
        const { token } = await seedUserDirectly({ email: 'notifications-read-all@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        await createMonthlyBudget(token, { amount: 50, categoryId })
        await createTestExpense(token, {
            title: 'Overspend',
            amount: 75,
            date: '2026-01-08T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        await createRecurringBill(token, todayDateStr())

        const before = await request(app).get('/api/v1/notifications').set(authHeader(token))
        expect(before.body.data.unreadCount).toBeGreaterThan(0)

        const readAllRes = await request(app)
            .patch('/api/v1/notifications/read-all')
            .set(authHeader(token))

        expect(readAllRes.status).toBe(200)

        const after = await request(app).get('/api/v1/notifications').set(authHeader(token))
        expect(after.body.data.unreadCount).toBe(0)
    })

    it('returns 403 when another user tries to dismiss a notification', async () => {
        const owner = await seedUserDirectly({ email: 'notifications-owner@example.com' })
        const other = await createSecondUser(app)
        const account = await createTestAccount(owner.token)
        const categoryId = await getFoodMasterId(owner.token)

        await createMonthlyBudget(owner.token, { amount: 50, categoryId })
        await createTestExpense(owner.token, {
            title: 'Overspend',
            amount: 75,
            date: '2026-01-08T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })

        const listRes = await request(app)
            .get('/api/v1/notifications')
            .set(authHeader(owner.token))
        const notificationId = listRes.body.data.notifications[0]._id

        const res = await request(app)
            .patch(`/api/v1/notifications/${notificationId}/dismiss`)
            .set(authHeader(other.token))

        expect(res.status).toBe(403)
    })

    it('updates notification preferences on the user profile', async () => {
        const { token } = await seedUserDirectly({ email: 'notifications-prefs@example.com' })

        const res = await request(app)
            .patch('/api/v1/auth/user')
            .set(authHeader(token))
            .send({
                notificationPreferences: {
                    billRemindersEnabled: false,
                    billReminderDaysBefore: 7,
                },
            })

        expect(res.status).toBe(200)
        expect(res.body.data.notificationPreferences).toMatchObject({
            billRemindersEnabled: false,
            billReminderDaysBefore: 7,
        })

        const user = await User.findOne({ email: 'notifications-prefs@example.com' })
        expect(user?.notificationPreferences.billRemindersEnabled).toBe(false)
        expect(user?.notificationPreferences.billReminderDaysBefore).toBe(7)
    })
})
