import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Notification } from '@modules/notifications'
import { authHeader, createSecondUser, seedUserDirectly } from './helpers'

const JAN_2026 = { startDate: '2026-01-01', endDate: '2026-01-31' }
const JAN_2026_MONTHLY = { periodType: 'monthly', year: 2026, month: 1 }

async function createWorkspace(token: string, name = 'Shared Finances') {
    return request(app)
        .post('/api/v1/workspaces')
        .set(authHeader(token))
        .send({ name })
}

async function inviteMember(
    ownerToken: string,
    workspaceId: string,
    email: string,
    role: 'editor' | 'viewer' = 'editor',
    inviteeToken?: string
) {
    const inviteRes = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/members`)
        .set(authHeader(ownerToken))
        .send({ email, role })

    if (inviteeToken) {
        expect(inviteRes.status).toBe(201)
        await request(app)
            .post(`/api/v1/workspaces/invites/${inviteRes.body.data._id}/accept`)
            .set(authHeader(inviteeToken))
    }

    return inviteRes
}

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

async function createWorkspaceAccount(
    token: string,
    workspaceId: string,
    name = 'Shared Checking',
    openingBalance = 5000
) {
    return request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'checking', openingBalance, workspaceId })
}

async function createPersonalAccount(token: string, name = 'Personal Checking', openingBalance = 5000) {
    return request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'checking', openingBalance })
}

async function createWorkspaceExpense(
    token: string,
    workspaceId: string,
    accountId: string,
    categoryId: string,
    amount: number,
    title: string
) {
    return request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({
            type: 'expense',
            title,
            amount,
            date: '2026-01-15T12:00:00.000Z',
            accountId,
            categoryId,
            workspaceId,
        })
}

function todayDateStr(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date())
}

async function seedWorkspaceWithEditor() {
    const owner = await seedUserDirectly({ email: 'ws-scope-owner@example.com' })
    const editor = await seedUserDirectly({
        fullName: 'Scope Editor',
        email: 'ws-scope-editor@example.com',
        password: 'ScopeEditor123!',
    })

    const workspaceRes = await createWorkspace(owner.token, 'Scope Test')
    const workspaceId = workspaceRes.body.data._id

    await inviteMember(owner.token, workspaceId, editor.email, 'editor', editor.token)

    return { owner, editor, workspaceId }
}

describe('Workspace scoping - savings goals', () => {
    it('shares workspace savings goals with members and isolates personal goals', async () => {
        const { owner, editor, workspaceId } = await seedWorkspaceWithEditor()

        await request(app)
            .post('/api/v1/savings-goals')
            .set(authHeader(owner.token))
            .send({ name: 'Team emergency fund', targetAmount: 2000, workspaceId })

        await request(app)
            .post('/api/v1/savings-goals')
            .set(authHeader(owner.token))
            .send({ name: 'Personal vacation', targetAmount: 500 })

        const sharedList = await request(app)
            .get('/api/v1/savings-goals')
            .query({ workspaceId })
            .set(authHeader(editor.token))

        expect(sharedList.status).toBe(200)
        expect(sharedList.body.data).toHaveLength(1)
        expect(sharedList.body.data[0].name).toBe('Team emergency fund')

        const personalList = await request(app)
            .get('/api/v1/savings-goals')
            .set(authHeader(owner.token))

        expect(personalList.body.data).toHaveLength(1)
        expect(personalList.body.data[0].name).toBe('Personal vacation')
    })

    it('allows editors to create workspace goals and blocks viewers', async () => {
        const owner = await seedUserDirectly({ email: 'ws-goal-rbac-owner@example.com' })
        const viewer = await seedUserDirectly({
            fullName: 'Goal Viewer',
            email: 'ws-goal-viewer@example.com',
            password: 'GoalViewer123!',
        })

        const workspaceRes = await createWorkspace(owner.token)
        const workspaceId = workspaceRes.body.data._id
        await inviteMember(owner.token, workspaceId, viewer.email, 'viewer', viewer.token)

        const editorCreate = await request(app)
            .post('/api/v1/savings-goals')
            .set(authHeader(owner.token))
            .send({ name: 'Allowed goal', targetAmount: 1000, workspaceId })

        expect(editorCreate.status).toBe(201)

        const viewerCreate = await request(app)
            .post('/api/v1/savings-goals')
            .set(authHeader(viewer.token))
            .send({ name: 'Blocked goal', targetAmount: 1000, workspaceId })

        expect(viewerCreate.status).toBe(403)
    })

    it('returns 403 when a non-member lists workspace savings goals', async () => {
        const owner = await seedUserDirectly({ email: 'ws-goal-outsider-owner@example.com' })
        const outsider = await createSecondUser(app)

        const workspaceRes = await createWorkspace(owner.token)
        const workspaceId = workspaceRes.body.data._id

        await request(app)
            .post('/api/v1/savings-goals')
            .set(authHeader(owner.token))
            .send({ name: 'Private team goal', targetAmount: 800, workspaceId })

        const res = await request(app)
            .get('/api/v1/savings-goals')
            .query({ workspaceId })
            .set(authHeader(outsider.token))

        expect(res.status).toBe(403)
    })

    it('allows workspace members to contribute to shared goals', async () => {
        const { owner, editor, workspaceId } = await seedWorkspaceWithEditor()

        const createRes = await request(app)
            .post('/api/v1/savings-goals')
            .set(authHeader(owner.token))
            .send({ name: 'Shared fund', targetAmount: 1000, workspaceId })

        const goalId = createRes.body.data._id

        const contribRes = await request(app)
            .post(`/api/v1/savings-goals/${goalId}/contribute`)
            .set(authHeader(editor.token))
            .send({ amount: 200 })

        expect(contribRes.status).toBe(200)
        expect(contribRes.body.data.data.goal.currentAmount).toBe(200)
    })
})

describe('Workspace scoping - recurring rules', () => {
    it('shares workspace recurring rules with members and isolates personal rules', async () => {
        const { owner, editor, workspaceId } = await seedWorkspaceWithEditor()
        const accountRes = await createWorkspaceAccount(owner.token, workspaceId)
        const categoryId = await getFoodMasterId(owner.token)

        await request(app)
            .post('/api/v1/recurring-rules')
            .set(authHeader(owner.token))
            .send({
                title: 'Team rent',
                type: 'expense',
                amount: 1200,
                accountId: accountRes.body.data._id,
                categoryId,
                interval: 'monthly',
                nextDueDate: '2026-03-01',
                workspaceId,
            })

        const personalAccount = await createPersonalAccount(owner.token)
        await request(app)
            .post('/api/v1/recurring-rules')
            .set(authHeader(owner.token))
            .send({
                title: 'Personal subscription',
                type: 'expense',
                amount: 9.99,
                accountId: personalAccount.body.data._id,
                categoryId,
                interval: 'monthly',
                nextDueDate: '2026-03-01',
            })

        const sharedList = await request(app)
            .get('/api/v1/recurring-rules')
            .query({ workspaceId })
            .set(authHeader(editor.token))

        expect(sharedList.status).toBe(200)
        expect(sharedList.body.data).toHaveLength(1)
        expect(sharedList.body.data[0].title).toBe('Team rent')

        const personalList = await request(app)
            .get('/api/v1/recurring-rules')
            .set(authHeader(owner.token))

        expect(personalList.body.data).toHaveLength(1)
        expect(personalList.body.data[0].title).toBe('Personal subscription')
    })

    it('blocks viewers from creating workspace recurring rules', async () => {
        const owner = await seedUserDirectly({ email: 'ws-recur-rbac-owner@example.com' })
        const viewer = await seedUserDirectly({
            fullName: 'Recur Viewer',
            email: 'ws-recur-viewer@example.com',
            password: 'RecurViewer123!',
        })

        const workspaceRes = await createWorkspace(owner.token)
        const workspaceId = workspaceRes.body.data._id
        const accountRes = await createWorkspaceAccount(owner.token, workspaceId)
        const categoryId = await getFoodMasterId(owner.token)

        await inviteMember(owner.token, workspaceId, viewer.email, 'viewer', viewer.token)

        const res = await request(app)
            .post('/api/v1/recurring-rules')
            .set(authHeader(viewer.token))
            .send({
                title: 'Blocked bill',
                type: 'expense',
                amount: 50,
                accountId: accountRes.body.data._id,
                categoryId,
                interval: 'monthly',
                nextDueDate: '2026-04-01',
                workspaceId,
            })

        expect(res.status).toBe(403)
    })

    it('generates drafts only for workspace rules when workspaceId is provided', async () => {
        const { owner, workspaceId } = await seedWorkspaceWithEditor()
        const accountRes = await createWorkspaceAccount(owner.token, workspaceId)
        const categoryId = await getFoodMasterId(owner.token)
        const personalAccount = await createPersonalAccount(owner.token)

        await request(app)
            .post('/api/v1/recurring-rules')
            .set(authHeader(owner.token))
            .send({
                title: 'Workspace due bill',
                type: 'expense',
                amount: 75,
                accountId: accountRes.body.data._id,
                categoryId,
                interval: 'monthly',
                nextDueDate: '2020-01-01',
                workspaceId,
            })

        await request(app)
            .post('/api/v1/recurring-rules')
            .set(authHeader(owner.token))
            .send({
                title: 'Personal due bill',
                type: 'expense',
                amount: 25,
                accountId: personalAccount.body.data._id,
                categoryId,
                interval: 'monthly',
                nextDueDate: '2020-01-01',
            })

        await request(app)
            .post('/api/v1/recurring-rules/generate-drafts')
            .query({ workspaceId })
            .set(authHeader(owner.token))

        await request(app)
            .post('/api/v1/recurring-rules/generate-drafts')
            .set(authHeader(owner.token))

        const workspaceDraftList = await request(app)
            .get('/api/v1/recurring-rules/drafts')
            .query({ workspaceId })
            .set(authHeader(owner.token))

        expect(workspaceDraftList.status).toBe(200)
        expect(workspaceDraftList.body.data.length).toBeGreaterThan(0)
        expect(
            workspaceDraftList.body.data.every(
                (draft: { title: string }) => draft.title === 'Workspace due bill'
            )
        ).toBe(true)

        const personalDraftList = await request(app)
            .get('/api/v1/recurring-rules/drafts')
            .set(authHeader(owner.token))

        expect(personalDraftList.body.data.length).toBeGreaterThan(0)
        expect(
            personalDraftList.body.data.every(
                (draft: { title: string }) => draft.title === 'Personal due bill'
            )
        ).toBe(true)
    })
})

describe('Workspace scoping - saved reports', () => {
    it('lists workspace saved reports separately from personal reports', async () => {
        const { owner, editor, workspaceId } = await seedWorkspaceWithEditor()

        await request(app)
            .post('/api/v1/dashboard/reports/saved')
            .set(authHeader(owner.token))
            .send({
                name: 'Workspace breakdown',
                workspaceId,
                ...JAN_2026_MONTHLY,
                splitBy: 'category',
                chartType: 'donut',
                dataType: 'expense',
            })

        await request(app)
            .post('/api/v1/dashboard/reports/saved')
            .set(authHeader(owner.token))
            .send({
                name: 'Personal summary',
                ...JAN_2026_MONTHLY,
                splitBy: 'total',
                chartType: 'table',
                dataType: 'both',
            })

        const sharedList = await request(app)
            .get('/api/v1/dashboard/reports/saved')
            .query({ workspaceId })
            .set(authHeader(editor.token))

        expect(sharedList.status).toBe(200)
        expect(sharedList.body.data).toHaveLength(1)
        expect(sharedList.body.data[0].name).toBe('Workspace breakdown')

        const personalList = await request(app)
            .get('/api/v1/dashboard/reports/saved')
            .set(authHeader(owner.token))

        expect(personalList.body.data).toHaveLength(1)
        expect(personalList.body.data[0].name).toBe('Personal summary')
    })

    it('runs a saved report using its workspace context', async () => {
        const { owner, workspaceId } = await seedWorkspaceWithEditor()
        const workspaceAccount = await createWorkspaceAccount(owner.token, workspaceId)
        const personalAccount = await createPersonalAccount(owner.token)
        const foodCategoryId = await getFoodMasterId(owner.token)

        await createWorkspaceExpense(
            owner.token,
            workspaceId,
            workspaceAccount.body.data._id,
            foodCategoryId,
            100,
            'Team lunch'
        )

        await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(owner.token))
            .send({
                type: 'expense',
                title: 'Personal groceries',
                amount: 400,
                date: '2026-01-10T12:00:00.000Z',
                accountId: personalAccount.body.data._id,
                categoryId: foodCategoryId,
            })

        const createRes = await request(app)
            .post('/api/v1/dashboard/reports/saved')
            .set(authHeader(owner.token))
            .send({
                name: 'Workspace expenses',
                workspaceId,
                ...JAN_2026_MONTHLY,
                splitBy: 'total',
                chartType: 'table',
                dataType: 'expense',
            })

        const runRes = await request(app)
            .get(`/api/v1/dashboard/reports/saved/${createRes.body.data._id}/run`)
            .set(authHeader(owner.token))

        expect(runRes.status).toBe(200)
        expect(runRes.body.data.result.rows[0].expense).toBe(100)
    })

    it('returns 403 when a non-member accesses workspace saved reports', async () => {
        const owner = await seedUserDirectly({ email: 'ws-report-outsider-owner@example.com' })
        const outsider = await createSecondUser(app)

        const workspaceRes = await createWorkspace(owner.token)
        const workspaceId = workspaceRes.body.data._id

        const res = await request(app)
            .get('/api/v1/dashboard/reports/saved')
            .query({ workspaceId })
            .set(authHeader(outsider.token))

        expect(res.status).toBe(403)
    })
})

describe('Workspace scoping - dashboard and reports analytics', () => {
    async function seedMixedScopeData(ownerToken: string, workspaceId: string) {
        const workspaceAccount = await createWorkspaceAccount(ownerToken, workspaceId)
        const personalAccount = await createPersonalAccount(ownerToken)
        const foodCategoryId = await getFoodMasterId(ownerToken)
        const incomeCategoryId = await getIncomeMasterId(ownerToken)

        await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(ownerToken))
            .send({
                type: 'income',
                title: 'Workspace income',
                amount: 1000,
                date: '2026-01-05T12:00:00.000Z',
                accountId: workspaceAccount.body.data._id,
                categoryId: incomeCategoryId,
                workspaceId,
            })

        await createWorkspaceExpense(
            ownerToken,
            workspaceId,
            workspaceAccount.body.data._id,
            foodCategoryId,
            200,
            'Workspace expense'
        )

        await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(ownerToken))
            .send({
                type: 'income',
                title: 'Personal income',
                amount: 3000,
                date: '2026-01-05T12:00:00.000Z',
                accountId: personalAccount.body.data._id,
                categoryId: incomeCategoryId,
            })

        await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(ownerToken))
            .send({
                type: 'expense',
                title: 'Personal expense',
                amount: 500,
                date: '2026-01-12T12:00:00.000Z',
                accountId: personalAccount.body.data._id,
                categoryId: foodCategoryId,
            })
    }

    it('filters dashboard summary by workspaceId', async () => {
        const { owner, editor, workspaceId } = await seedWorkspaceWithEditor()
        await seedMixedScopeData(owner.token, workspaceId)

        const workspaceSummary = await request(app)
            .get('/api/v1/dashboard/summary')
            .query({ ...JAN_2026, workspaceId })
            .set(authHeader(editor.token))

        expect(workspaceSummary.status).toBe(200)
        expect(workspaceSummary.body.data.totalIncome).toBe(1000)
        expect(workspaceSummary.body.data.totalExpenses).toBe(200)
        expect(workspaceSummary.body.data.netSavings).toBe(800)

        const personalSummary = await request(app)
            .get('/api/v1/dashboard/summary')
            .query(JAN_2026)
            .set(authHeader(owner.token))

        expect(personalSummary.body.data.totalIncome).toBe(3000)
        expect(personalSummary.body.data.totalExpenses).toBe(500)
        expect(personalSummary.body.data.netSavings).toBe(2500)
    })

    it('filters report savings-rate by workspaceId', async () => {
        const { owner, workspaceId } = await seedWorkspaceWithEditor()
        await seedMixedScopeData(owner.token, workspaceId)

        const workspaceReport = await request(app)
            .get('/api/v1/dashboard/reports/savings-rate')
            .query({ ...JAN_2026_MONTHLY, workspaceId })
            .set(authHeader(owner.token))

        expect(workspaceReport.status).toBe(200)
        expect(workspaceReport.body.data.totalIncome).toBe(1000)
        expect(workspaceReport.body.data.totalExpenses).toBe(200)
        expect(workspaceReport.body.data.savingsRate).toBeCloseTo(80, 1)

        const personalReport = await request(app)
            .get('/api/v1/dashboard/reports/savings-rate')
            .query(JAN_2026_MONTHLY)
            .set(authHeader(owner.token))

        expect(personalReport.body.data.totalIncome).toBe(3000)
        expect(personalReport.body.data.totalExpenses).toBe(500)
        expect(personalReport.body.data.savingsRate).toBeCloseTo((2500 / 3000) * 100, 1)
    })

    it('returns 403 when a non-member queries workspace dashboard analytics', async () => {
        const owner = await seedUserDirectly({ email: 'ws-dash-outsider-owner@example.com' })
        const outsider = await createSecondUser(app)

        const workspaceRes = await createWorkspace(owner.token)
        const workspaceId = workspaceRes.body.data._id

        const res = await request(app)
            .get('/api/v1/dashboard/summary')
            .query({ ...JAN_2026, workspaceId })
            .set(authHeader(outsider.token))

        expect(res.status).toBe(403)
    })
})

describe('Workspace scoping - notification triggers', () => {
    it('creates budget over-limit notifications only for matching workspace budgets', async () => {
        const { owner, workspaceId } = await seedWorkspaceWithEditor()
        const workspaceAccount = await createWorkspaceAccount(owner.token, workspaceId)
        const personalAccount = await createPersonalAccount(owner.token)
        const foodCategoryId = await getFoodMasterId(owner.token)

        await request(app)
            .post('/api/v1/budgets')
            .set(authHeader(owner.token))
            .send({
                periodType: 'monthly',
                year: 2026,
                month: 1,
                amount: 100,
                name: 'Workspace food',
                workspaceId,
                accountIds: [workspaceAccount.body.data._id],
                categoryId: foodCategoryId,
            })

        await request(app)
            .post('/api/v1/budgets')
            .set(authHeader(owner.token))
            .send({
                periodType: 'monthly',
                year: 2026,
                month: 1,
                amount: 100,
                name: 'Personal food',
                categoryId: foodCategoryId,
            })

        await createWorkspaceExpense(
            owner.token,
            workspaceId,
            workspaceAccount.body.data._id,
            foodCategoryId,
            150,
            'Team overspend'
        )

        await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(owner.token))
            .send({
                type: 'expense',
                title: 'Personal overspend',
                amount: 200,
                date: '2026-01-15T12:00:00.000Z',
                accountId: personalAccount.body.data._id,
                categoryId: foodCategoryId,
            })

        const notifications = await Notification.find({ userId: owner.userId })
        const budgetNotifications = notifications.filter((n) => n.type === 'budget_over_limit')

        expect(budgetNotifications).toHaveLength(2)
        expect(
            budgetNotifications.some((n) => n.message.includes('Workspace food'))
        ).toBe(true)
        expect(
            budgetNotifications.some((n) => n.message.includes('Personal food'))
        ).toBe(true)
    })

    it('syncs bill due reminders only for workspace recurring rules when workspaceId is provided', async () => {
        const { owner, workspaceId } = await seedWorkspaceWithEditor()
        const workspaceAccount = await createWorkspaceAccount(owner.token, workspaceId)
        const personalAccount = await createPersonalAccount(owner.token)
        const categoryId = await getFoodMasterId(owner.token)
        const dueDate = todayDateStr()

        await request(app)
            .post('/api/v1/recurring-rules')
            .set(authHeader(owner.token))
            .send({
                title: 'Workspace electric',
                type: 'expense',
                amount: 85,
                accountId: workspaceAccount.body.data._id,
                categoryId,
                interval: 'monthly',
                nextDueDate: dueDate,
                workspaceId,
            })

        await request(app)
            .post('/api/v1/recurring-rules')
            .set(authHeader(owner.token))
            .send({
                title: 'Personal electric',
                type: 'expense',
                amount: 60,
                accountId: personalAccount.body.data._id,
                categoryId,
                interval: 'monthly',
                nextDueDate: dueDate,
            })

        const workspaceNotifications = await request(app)
            .get('/api/v1/notifications')
            .query({ workspaceId })
            .set(authHeader(owner.token))

        expect(workspaceNotifications.status).toBe(200)
        expect(workspaceNotifications.body.data.notifications).toHaveLength(1)
        expect(workspaceNotifications.body.data.notifications[0].message).toContain('Workspace electric')

        const personalNotifications = await request(app)
            .get('/api/v1/notifications')
            .set(authHeader(owner.token))

        expect(personalNotifications.body.data.notifications.some((n: { message: string }) =>
            n.message.includes('Personal electric')
        )).toBe(true)
    })

    it('returns 403 when a non-member syncs workspace bill reminders', async () => {
        const owner = await seedUserDirectly({ email: 'ws-notif-outsider-owner@example.com' })
        const outsider = await createSecondUser(app)

        const workspaceRes = await createWorkspace(owner.token)
        const workspaceId = workspaceRes.body.data._id

        const res = await request(app)
            .get('/api/v1/notifications')
            .query({ workspaceId })
            .set(authHeader(outsider.token))

        expect(res.status).toBe(403)
    })
})

describe('Workspace scoping - transaction member attribution', () => {
    it('includes userFullName on workspace transactions but not personal ones', async () => {
        const { owner, editor, workspaceId } = await seedWorkspaceWithEditor()
        const workspaceAccount = await createWorkspaceAccount(owner.token, workspaceId)
        const personalAccount = await createPersonalAccount(owner.token)
        const foodCategoryId = await getFoodMasterId(owner.token)

        await createWorkspaceExpense(
            owner.token,
            workspaceId,
            workspaceAccount.body.data._id,
            foodCategoryId,
            120,
            'Owner groceries'
        )

        await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(editor.token))
            .send({
                type: 'expense',
                title: 'Editor lunch',
                amount: 45,
                date: '2026-01-16T12:00:00.000Z',
                accountId: workspaceAccount.body.data._id,
                categoryId: foodCategoryId,
                workspaceId,
            })

        await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(owner.token))
            .send({
                type: 'expense',
                title: 'Personal coffee',
                amount: 8,
                date: '2026-01-16T12:00:00.000Z',
                accountId: personalAccount.body.data._id,
                categoryId: foodCategoryId,
            })

        const workspaceList = await request(app)
            .get('/api/v1/transactions')
            .query({ workspaceId, limit: 20 })
            .set(authHeader(editor.token))

        expect(workspaceList.status).toBe(200)
        expect(workspaceList.body.data.data).toHaveLength(2)

        const ownerTx = workspaceList.body.data.data.find(
            (tx: { title: string }) => tx.title === 'Owner groceries'
        )
        const editorTx = workspaceList.body.data.data.find(
            (tx: { title: string }) => tx.title === 'Editor lunch'
        )

        expect(ownerTx.userFullName).toBe('Test User')
        expect(editorTx.userFullName).toBe('Scope Editor')

        const personalList = await request(app)
            .get('/api/v1/transactions')
            .query({ limit: 20 })
            .set(authHeader(owner.token))

        const personalTx = personalList.body.data.data.find(
            (tx: { title: string }) => tx.title === 'Personal coffee'
        )

        expect(personalTx.userFullName).toBeUndefined()
    })
})
