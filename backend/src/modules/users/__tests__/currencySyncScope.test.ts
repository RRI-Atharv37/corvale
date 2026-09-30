import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { Account } from '@modules/accounts'
import { Budget } from '@modules/budgets'
import { RecurringRule } from '@modules/recurring'
import { SavingsGoal } from '@modules/savings-goals'
import { Transaction } from '@modules/transactions'
import { Workspace } from '@modules/workspaces'
import { authHeader, seedUserDirectly, type RegisteredUser } from '@tests/helpers'
import { createAccountViaApi, createExpenseViaApi, getFoodMasterId, seedWorkspace } from '@tests/billingHelpers'

describe('BUG-47 / SEC-79 - a currency change leaves shared workspace records alone', () => {
    let owner: RegisteredUser
    let member: RegisteredUser
    let workspaceId: string
    let workspaceAccountId: string
    let personalAccountId: string
    let categoryId: string

    const changeCurrency = (token: string, preferredCurrency = 'EUR') =>
        request(app).patch('/api/v1/auth/user').set(authHeader(token)).send({ preferredCurrency })

    beforeEach(async () => {
        owner = await seedUserDirectly({ email: 'cur-owner@example.com' })
        member = await seedUserDirectly({ email: 'cur-member@example.com' })
        workspaceId = await seedWorkspace(owner.userId, [{ userId: member.userId, role: 'editor' }])

        categoryId = await getFoodMasterId(app, member.token)
        workspaceAccountId = await createAccountViaApi(app, member.token, { workspaceId, currency: 'USD' })
        personalAccountId = await createAccountViaApi(app, member.token, { name: 'Mine', currency: 'USD' })

        expect((await createExpenseViaApi(app, member.token, workspaceAccountId, categoryId, { workspaceId, title: 'Shared' })).status).toBe(201)
        expect((await createExpenseViaApi(app, member.token, personalAccountId, categoryId, { title: 'Private' })).status).toBe(201)

        await Budget.create({
            userId: member.userId,
            workspaceId,
            name: 'Shared budget',
            periodType: 'monthly',
            periodStart: new Date('2026-01-01'),
            periodEnd: new Date('2026-01-31'),
            amount: 100,
            currency: 'USD',
        })
        await SavingsGoal.create({ userId: member.userId, workspaceId, name: 'Shared goal', targetAmount: 100, currency: 'USD' })
        await RecurringRule.create({
            userId: member.userId,
            workspaceId,
            title: 'Shared rent',
            type: 'expense',
            amount: 100,
            currency: 'USD',
            accountId: workspaceAccountId,
            categoryId,
            interval: 'monthly',
            nextDueDate: new Date('2026-02-01T12:00:00.000Z'),
        })
    })

    it('relabels only personal records', async () => {
        const res = await changeCurrency(member.token)

        expect(res.status).toBe(200)
        expect((await Account.findById(personalAccountId).lean())?.currency).toBe('EUR')
        expect((await Transaction.findOne({ title: 'Private' }).lean())?.currency).toBe('EUR')

        expect((await Account.findById(workspaceAccountId).lean())?.currency).toBe('USD')
        expect((await Transaction.findOne({ title: 'Shared' }).lean())?.currency).toBe('USD')
        expect((await Budget.findOne({ workspaceId }).lean())?.currency).toBe('USD')
        expect((await SavingsGoal.findOne({ workspaceId }).lean())?.currency).toBe('USD')
        expect((await RecurringRule.findOne({ workspaceId }).lean())?.currency).toBe('USD')
    })

    it('leaves shared records untouched for a member demoted to viewer', async () => {
        await Workspace.updateOne({ _id: workspaceId, 'members.userId': member.userId }, { $set: { 'members.$.role': 'viewer' } })

        const res = await changeCurrency(member.token)

        expect(res.status).toBe(200)
        expect((await Account.findById(workspaceAccountId).lean())?.currency).toBe('USD')
        expect((await Transaction.findOne({ title: 'Shared' }).lean())?.currency).toBe('USD')
    })

    it("does not move the other members' view of the shared account", async () => {
        await changeCurrency(member.token)

        const res = await request(app).get(`/api/v1/accounts/${workspaceAccountId}`).query({ workspaceId }).set(authHeader(owner.token))

        expect(res.status).toBe(200)
        expect(res.body.data.currency).toBe('USD')
    })
})
