import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Account } from '@modules/accounts'
import { RecurringRule } from '@modules/recurring'
import { Transaction } from '@modules/transactions'
import { startOfDayInTimezone } from '@core/time/timezoneUtils'
import { authHeader, seedUserDirectly } from './helpers'
import { advanceNextDueDate } from "@modules/recurring/recurringRuleUtils";

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const food = res.body.data.masters.find((m: { name: string }) => m.name === 'Food')
    if (!food) {
        throw new Error('Food master category not found')
    }
    return food._id
}

async function getIncomeMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const income = res.body.data.masters.find((m: { name: string }) => m.name === 'Income')
    if (!income) {
        throw new Error('Income master category not found')
    }
    return income._id
}

async function createTestAccount(token: string, name = 'Checking', openingBalance = 1000) {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'checking', openingBalance })

    return res.body.data
}

async function createRecurringRule(
    token: string,
    overrides: Record<string, unknown> = {}
) {
    const account = overrides.accountId
        ? { _id: overrides.accountId }
        : await createTestAccount(token)
    const categoryId =
        typeof overrides.categoryId === 'string'
            ? overrides.categoryId
            : await getFoodMasterId(token)

    return request(app)
        .post('/api/v1/recurring-rules')
        .set(authHeader(token))
        .send({
            title: 'Rent',
            type: 'expense',
            amount: 1200,
            accountId: account._id,
            categoryId,
            interval: 'monthly',
            nextDueDate: '2026-02-01',
            ...overrides,
        })
}

describe('Recurring rules - CRUD and ownership', () => {
    it('creates a recurring expense rule', async () => {
        const { token } = await seedUserDirectly({ email: 'recurring-create@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const res = await createRecurringRule(token, {
            title: 'Netflix',
            amount: 15.99,
            accountId: account._id,
            categoryId,
            interval: 'monthly',
            nextDueDate: '2026-03-15',
            description: 'Streaming',
        })

        expect(res.status).toBe(201)
        expect(res.body.success).toBe(true)
        expect(res.body.data.title).toBe('Netflix')
        expect(res.body.data.type).toBe('expense')
        expect(res.body.data.amount).toBe(15.99)
        expect(res.body.data.interval).toBe('monthly')
        expect(res.body.data.isActive).toBe(true)
        expect(res.body.data.isArchived).toBe(false)
        expect(res.body.data.accountId).toBe(account._id)
        expect(res.body.data.categoryId).toBe(categoryId)
    })

    it('creates a rule with custom interval days', async () => {
        const { token } = await seedUserDirectly({ email: 'recurring-custom@example.com' })

        const res = await createRecurringRule(token, {
            title: 'Bi-monthly bill',
            interval: 'custom',
            customIntervalDays: 45,
            nextDueDate: '2026-04-01',
        })

        expect(res.status).toBe(201)
        expect(res.body.data.interval).toBe('custom')
        expect(res.body.data.customIntervalDays).toBe(45)
    })

    it('lists only the authenticated user rules', async () => {
        const owner = await seedUserDirectly({ email: 'recurring-list-owner@example.com' })
        const other = await seedUserDirectly({ email: 'recurring-list-other@example.com' })

        await createRecurringRule(owner.token, { title: 'Owner rule' })
        await createRecurringRule(other.token, { title: 'Other rule' })

        const res = await request(app).get('/api/v1/recurring-rules').set(authHeader(owner.token))

        expect(res.status).toBe(200)
        expect(res.body.data).toHaveLength(1)
        expect(res.body.data[0].title).toBe('Owner rule')
    })

    it('filters rules by isActive and includes archived when requested', async () => {
        const { token } = await seedUserDirectly({ email: 'recurring-filter@example.com' })

        const activeRes = await createRecurringRule(token, { title: 'Active rule' })
        const pausedRes = await createRecurringRule(token, { title: 'Paused rule' })
        const archivedRes = await createRecurringRule(token, { title: 'Archived rule' })

        await request(app)
            .put(`/api/v1/recurring-rules/${pausedRes.body.data._id}`)
            .set(authHeader(token))
            .send({ isActive: false })

        await request(app)
            .delete(`/api/v1/recurring-rules/${archivedRes.body.data._id}`)
            .set(authHeader(token))

        const activeList = await request(app)
            .get('/api/v1/recurring-rules?isActive=true')
            .set(authHeader(token))

        expect(activeList.body.data).toHaveLength(1)
        expect(activeList.body.data[0].title).toBe('Active rule')

        const inactiveList = await request(app)
            .get('/api/v1/recurring-rules?isActive=false')
            .set(authHeader(token))

        expect(inactiveList.body.data).toHaveLength(1)
        expect(inactiveList.body.data[0].title).toBe('Paused rule')

        const defaultList = await request(app).get('/api/v1/recurring-rules').set(authHeader(token))
        expect(defaultList.body.data).toHaveLength(2)

        const withArchived = await request(app)
            .get('/api/v1/recurring-rules?includeArchived=true')
            .set(authHeader(token))

        expect(withArchived.body.data).toHaveLength(3)
    })

    it('gets a rule by id', async () => {
        const { token } = await seedUserDirectly({ email: 'recurring-get@example.com' })
        const createRes = await createRecurringRule(token, { title: 'Gym membership' })
        const ruleId = createRes.body.data._id

        const res = await request(app)
            .get(`/api/v1/recurring-rules/${ruleId}`)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data._id).toBe(ruleId)
        expect(res.body.data.title).toBe('Gym membership')
    })

    it('updates rule fields', async () => {
        const { token } = await seedUserDirectly({ email: 'recurring-update@example.com' })
        const account = await createTestAccount(token, 'Savings')
        const categoryId = await getIncomeMasterId(token)
        const createRes = await createRecurringRule(token)
        const ruleId = createRes.body.data._id

        const res = await request(app)
            .put(`/api/v1/recurring-rules/${ruleId}`)
            .set(authHeader(token))
            .send({
                title: 'Updated rent',
                type: 'income',
                amount: 1500,
                accountId: account._id,
                categoryId,
                interval: 'weekly',
                nextDueDate: '2026-05-01',
                isActive: false,
            })

        expect(res.status).toBe(200)
        expect(res.body.data.title).toBe('Updated rent')
        expect(res.body.data.type).toBe('income')
        expect(res.body.data.amount).toBe(1500)
        expect(res.body.data.interval).toBe('weekly')
        expect(res.body.data.isActive).toBe(false)
        expect(res.body.data.accountId).toBe(account._id)
        expect(res.body.data.categoryId).toBe(categoryId)
    })

    it('archives a rule via DELETE', async () => {
        const { token } = await seedUserDirectly({ email: 'recurring-archive@example.com' })
        const createRes = await createRecurringRule(token)
        const ruleId = createRes.body.data._id

        const res = await request(app)
            .delete(`/api/v1/recurring-rules/${ruleId}`)
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data.data.isArchived).toBe(true)
        expect(res.body.data.data.isActive).toBe(false)
    })

    it('returns 403 when accessing another user rule', async () => {
        const owner = await seedUserDirectly({ email: 'recurring-owner@example.com' })
        const other = await seedUserDirectly({ email: 'recurring-other@example.com' })

        const createRes = await createRecurringRule(owner.token)
        const ruleId = createRes.body.data._id

        const getRes = await request(app)
            .get(`/api/v1/recurring-rules/${ruleId}`)
            .set(authHeader(other.token))

        expect(getRes.status).toBe(403)

        const updateRes = await request(app)
            .put(`/api/v1/recurring-rules/${ruleId}`)
            .set(authHeader(other.token))
            .send({ title: 'Hacked' })

        expect(updateRes.status).toBe(403)

        const archiveRes = await request(app)
            .delete(`/api/v1/recurring-rules/${ruleId}`)
            .set(authHeader(other.token))

        expect(archiveRes.status).toBe(403)
    })

    it('rejects another user account id on create', async () => {
        const { token } = await seedUserDirectly({ email: 'recurring-invalid-ref@example.com' })
        const other = await seedUserDirectly({ email: 'recurring-invalid-ref-other@example.com' })
        const otherAccount = await createTestAccount(other.token, 'Other account')

        const badAccount = await createRecurringRule(token, { accountId: otherAccount._id })
        expect(badAccount.status).toBe(403)
        expect(badAccount.body.message).toMatch(/not authorized/i)
    })

    it('rejects a non-existent account id on create', async () => {
        const { token } = await seedUserDirectly({ email: 'recurring-missing-account@example.com' })
        const fakeAccountId = '507f1f77bcf86cd799439011'

        const res = await createRecurringRule(token, { accountId: fakeAccountId })
        expect(res.status).toBe(404)
        expect(res.body.message).toMatch(/account not found/i)
    })

    it('rejects update on an archived rule', async () => {
        const { token } = await seedUserDirectly({ email: 'recurring-archived-update@example.com' })
        const createRes = await createRecurringRule(token)
        const ruleId = createRes.body.data._id

        await request(app).delete(`/api/v1/recurring-rules/${ruleId}`).set(authHeader(token))

        const res = await request(app)
            .put(`/api/v1/recurring-rules/${ruleId}`)
            .set(authHeader(token))
            .send({ title: 'Should fail' })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/archived/i)
    })

    it('rejects invalid amount, type, interval, and nextDueDate', async () => {
        const { token } = await seedUserDirectly({ email: 'recurring-validation@example.com' })

        const zeroAmount = await createRecurringRule(token, { amount: 0 })
        expect(zeroAmount.status).toBe(400)
        expect(zeroAmount.body.message).toMatch(/invalid recurring amount/i)

        const badType = await createRecurringRule(token, { type: 'transfer' })
        expect(badType.status).toBe(400)
        expect(badType.body.message).toMatch(/income or expense/i)

        const badInterval = await createRecurringRule(token, { interval: 'fortnightly' })
        expect(badInterval.status).toBe(400)
        expect(badInterval.body.message).toMatch(/invalid interval/i)

        const badDate = await createRecurringRule(token, { nextDueDate: 'not-a-date' })
        expect(badDate.status).toBe(400)
        expect(badDate.body.message).toMatch(/invalid nextDueDate/i)

        const badCustomDays = await createRecurringRule(token, {
            interval: 'custom',
            customIntervalDays: 0,
        })
        expect(badCustomDays.status).toBe(400)
        expect(badCustomDays.body.message).toMatch(/customIntervalDays/i)
    })
})

describe('Recurring rules - draft generation', () => {
    it('generates a draft when nextDueDate is due and advances the rule', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'recurring-gen-one@example.com' })
        const createRes = await createRecurringRule(token, {
            title: 'Due today',
            amount: 50,
            interval: 'monthly',
            nextDueDate: '2020-01-15',
        })
        const ruleId = createRes.body.data._id

        const genRes = await request(app)
            .post('/api/v1/recurring-rules/generate-drafts')
            .set(authHeader(token))

        expect(genRes.status).toBe(200)
        expect(genRes.body.data.length).toBeGreaterThanOrEqual(1)
        expect(genRes.body.data[0]).toMatchObject({
            status: 'draft',
            type: 'expense',
            amount: 50,
            title: 'Due today',
            recurringPaymentId: ruleId,
        })

        const updatedRule = await RecurringRule.findById(ruleId)
        expect(updatedRule?.nextDueDate.getTime()).toBeGreaterThan(
            startOfDayInTimezone('2020-01-15', 'UTC').getTime()
        )

        const draftsRes = await request(app)
            .get('/api/v1/recurring-rules/drafts')
            .set(authHeader(token))

        expect(draftsRes.status).toBe(200)
        expect(draftsRes.body.data.length).toBeGreaterThanOrEqual(1)
        expect(draftsRes.body.data.every((d: { userId: string }) => d.userId === userId)).toBe(true)
    })

    it('generates drafts for a single rule via rule endpoint', async () => {
        const { token } = await seedUserDirectly({ email: 'recurring-gen-rule@example.com' })
        const createRes = await createRecurringRule(token, {
            nextDueDate: '2020-06-01',
            interval: 'weekly',
        })
        const ruleId = createRes.body.data._id

        const genRes = await request(app)
            .post(`/api/v1/recurring-rules/${ruleId}/generate-drafts`)
            .set(authHeader(token))

        expect(genRes.status).toBe(200)
        expect(genRes.body.data.length).toBeGreaterThanOrEqual(1)
        expect(genRes.body.data.every((d: { recurringPaymentId: string }) => d.recurringPaymentId === ruleId)).toBe(
            true
        )
    })

    it('does not create duplicate drafts for the same due date', async () => {
        const { token } = await seedUserDirectly({ email: 'recurring-no-dup@example.com' })
        const createRes = await createRecurringRule(token, {
            nextDueDate: '2020-03-01',
            interval: 'monthly',
        })
        const ruleId = createRes.body.data._id

        await request(app)
            .post(`/api/v1/recurring-rules/${ruleId}/generate-drafts`)
            .set(authHeader(token))

        await RecurringRule.findByIdAndUpdate(ruleId, {
            nextDueDate: startOfDayInTimezone('2020-03-01', 'UTC'),
        })

        const secondGen = await request(app)
            .post(`/api/v1/recurring-rules/${ruleId}/generate-drafts`)
            .set(authHeader(token))

        expect(secondGen.status).toBe(200)
        expect(secondGen.body.data).toHaveLength(0)

        const draftsRes = await request(app)
            .get(`/api/v1/recurring-rules/drafts?ruleId=${ruleId}`)
            .set(authHeader(token))

        const marchDrafts = draftsRes.body.data.filter((d: { date: string }) =>
            d.date.startsWith('2020-03-01')
        )
        expect(marchDrafts).toHaveLength(1)
    })

    it('skips inactive and archived rules', async () => {
        const { token } = await seedUserDirectly({ email: 'recurring-skip@example.com' })

        const inactiveRes = await createRecurringRule(token, {
            title: 'Inactive',
            nextDueDate: '2020-01-01',
        })
        await request(app)
            .put(`/api/v1/recurring-rules/${inactiveRes.body.data._id}`)
            .set(authHeader(token))
            .send({ isActive: false })

        const archivedRes = await createRecurringRule(token, {
            title: 'Archived',
            nextDueDate: '2020-01-01',
        })
        await request(app)
            .delete(`/api/v1/recurring-rules/${archivedRes.body.data._id}`)
            .set(authHeader(token))

        const genRes = await request(app)
            .post('/api/v1/recurring-rules/generate-drafts')
            .set(authHeader(token))

        expect(genRes.status).toBe(200)
        expect(genRes.body.data).toHaveLength(0)
    })

    it('returns no drafts when nextDueDate is in the future', async () => {
        const { token } = await seedUserDirectly({ email: 'recurring-future@example.com' })

        await createRecurringRule(token, { nextDueDate: '2099-12-31' })

        const genRes = await request(app)
            .post('/api/v1/recurring-rules/generate-drafts')
            .set(authHeader(token))

        expect(genRes.status).toBe(200)
        expect(genRes.body.data).toHaveLength(0)
    })
})

describe('Recurring rules - confirm and dismiss', () => {
    async function createDueRuleWithDraft(token: string, type: 'income' | 'expense' = 'expense') {
        const account = await createTestAccount(token, 'Draft account', 1000)
        const categoryId =
            type === 'income' ? await getIncomeMasterId(token) : await getFoodMasterId(token)

        const createRes = await createRecurringRule(token, {
            title: type === 'income' ? 'Salary' : 'Utilities',
            type,
            amount: 100,
            accountId: account._id,
            categoryId,
            nextDueDate: '2020-01-10',
            interval: 'monthly',
        })
        const ruleId = createRes.body.data._id

        const genRes = await request(app)
            .post(`/api/v1/recurring-rules/${ruleId}/generate-drafts`)
            .set(authHeader(token))

        return {
            accountId: account._id,
            ruleId,
            draft: genRes.body.data[0],
        }
    }

    it('confirms an expense draft and updates account balance', async () => {
        const { token } = await seedUserDirectly({ email: 'recurring-confirm-expense@example.com' })
        const { accountId, draft } = await createDueRuleWithDraft(token, 'expense')

        const confirmRes = await request(app)
            .post(`/api/v1/recurring-rules/drafts/${draft._id}/confirm`)
            .set(authHeader(token))

        expect(confirmRes.status).toBe(200)
        expect(confirmRes.body.data.status).toBe('posted')
        expect(confirmRes.body.data.amount).toBe(100)

        const account = await Account.findById(accountId)
        expect(account?.currentBalance).toBe(900)
    })

    it('confirms an income draft and increases account balance', async () => {
        const { token } = await seedUserDirectly({ email: 'recurring-confirm-income@example.com' })
        const { accountId, draft } = await createDueRuleWithDraft(token, 'income')

        const confirmRes = await request(app)
            .post(`/api/v1/recurring-rules/drafts/${draft._id}/confirm`)
            .set(authHeader(token))

        expect(confirmRes.status).toBe(200)
        expect(confirmRes.body.data.status).toBe('posted')

        const account = await Account.findById(accountId)
        expect(account?.currentBalance).toBe(1100)
    })

    it('dismisses a draft without changing account balance', async () => {
        const { token } = await seedUserDirectly({ email: 'recurring-dismiss@example.com' })
        const { accountId, draft } = await createDueRuleWithDraft(token, 'expense')

        const dismissRes = await request(app)
            .post(`/api/v1/recurring-rules/drafts/${draft._id}/dismiss`)
            .set(authHeader(token))

        expect(dismissRes.status).toBe(200)
        expect(dismissRes.body.data.message).toMatch(/dismissed successfully/i)

        const deleted = await Transaction.findById(draft._id)
        expect(deleted).toBeNull()

        const account = await Account.findById(accountId)
        expect(account?.currentBalance).toBe(1000)
    })

    it('rejects confirm on non-draft or non-recurring transactions', async () => {
        const { token } = await seedUserDirectly({ email: 'recurring-bad-confirm@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const postedRes = await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(token))
            .send({
                type: 'expense',
                title: 'Posted expense',
                amount: 25,
                date: '2026-01-15',
                accountId: account._id,
                categoryId,
            })

        const confirmPosted = await request(app)
            .post(`/api/v1/recurring-rules/drafts/${postedRes.body.data._id}/confirm`)
            .set(authHeader(token))

        expect(confirmPosted.status).toBe(400)
        expect(confirmPosted.body.message).toMatch(/not a draft/i)

        const manualDraft = await Transaction.create({
            userId: postedRes.body.data.userId,
            accountId: account._id,
            categoryId,
            type: 'expense',
            status: 'draft',
            amount: 2500,
            currency: 'USD',
            title: 'Manual draft',
            date: new Date('2026-01-15'),
        })

        const confirmManual = await request(app)
            .post(`/api/v1/recurring-rules/drafts/${manualDraft._id}/confirm`)
            .set(authHeader(token))

        expect(confirmManual.status).toBe(400)
        expect(confirmManual.body.message).toMatch(/not a recurring draft/i)
    })

    it('returns 403 when confirming or dismissing another user draft', async () => {
        const owner = await seedUserDirectly({ email: 'recurring-draft-owner@example.com' })
        const other = await seedUserDirectly({ email: 'recurring-draft-other@example.com' })

        const { draft } = await createDueRuleWithDraft(owner.token, 'expense')

        const confirmRes = await request(app)
            .post(`/api/v1/recurring-rules/drafts/${draft._id}/confirm`)
            .set(authHeader(other.token))

        expect(confirmRes.status).toBe(403)

        const dismissRes = await request(app)
            .post(`/api/v1/recurring-rules/drafts/${draft._id}/dismiss`)
            .set(authHeader(other.token))

        expect(dismissRes.status).toBe(403)
    })
})

describe('Recurring rules - interval math', () => {
    const utcDay = (dateStr: string) => startOfDayInTimezone(dateStr, 'UTC')

    it('advances daily, weekly, and biweekly intervals', () => {
        expect(advanceNextDueDate(utcDay('2026-01-15'), 'daily').toISOString()).toBe(
            utcDay('2026-01-16').toISOString()
        )
        expect(advanceNextDueDate(utcDay('2026-01-15'), 'weekly').toISOString()).toBe(
            utcDay('2026-01-22').toISOString()
        )
        expect(advanceNextDueDate(utcDay('2026-01-15'), 'biweekly').toISOString()).toBe(
            utcDay('2026-01-29').toISOString()
        )
    })

    it('advances monthly, quarterly, and yearly intervals', () => {
        expect(advanceNextDueDate(utcDay('2026-01-15'), 'monthly').toISOString()).toBe(
            utcDay('2026-02-15').toISOString()
        )
        expect(advanceNextDueDate(utcDay('2026-01-15'), 'quarterly').toISOString()).toBe(
            utcDay('2026-04-15').toISOString()
        )
        expect(advanceNextDueDate(utcDay('2026-01-15'), 'yearly').toISOString()).toBe(
            utcDay('2027-01-15').toISOString()
        )
    })

    it('advances custom intervals by the configured day count', () => {
        expect(advanceNextDueDate(utcDay('2026-01-01'), 'custom', 10).toISOString()).toBe(
            utcDay('2026-01-11').toISOString()
        )
        expect(advanceNextDueDate(utcDay('2026-01-01'), 'custom', 45).toISOString()).toBe(
            utcDay('2026-02-15').toISOString()
        )
    })
})
