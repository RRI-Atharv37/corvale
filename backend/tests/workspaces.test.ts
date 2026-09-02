import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { authHeader, createSecondUser, seedUserDirectly } from './helpers'

async function createWorkspace(token: string, name = 'Shared Finances') {
    return request(app)
        .post('/api/v1/workspaces')
        .set(authHeader(token))
        .send({ name })
}

async function sendWorkspaceInvite(
    ownerToken: string,
    workspaceId: string,
    email: string,
    role: 'editor' | 'viewer' = 'editor'
) {
    return request(app)
        .post(`/api/v1/workspaces/${workspaceId}/members`)
        .set(authHeader(ownerToken))
        .send({ email, role })
}

async function acceptWorkspaceInvite(inviteeToken: string, inviteId: string) {
    return request(app)
        .post(`/api/v1/workspaces/invites/${inviteId}/accept`)
        .set(authHeader(inviteeToken))
}

async function inviteAndAcceptMember(
    ownerToken: string,
    inviteeToken: string,
    workspaceId: string,
    email: string,
    role: 'editor' | 'viewer' = 'editor'
) {
    const inviteRes = await sendWorkspaceInvite(ownerToken, workspaceId, email, role)
    expect(inviteRes.status).toBe(201)
    return acceptWorkspaceInvite(inviteeToken, inviteRes.body.data._id)
}

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const food = res.body.data.masters.find((m: { name: string }) => m.name === 'Food')
    if (!food) {
        throw new Error('Food master category not found')
    }
    return food._id
}

async function createWorkspaceAccount(
    token: string,
    workspaceId: string,
    name = 'Shared Checking',
    openingBalance = 1000
) {
    return request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'checking', openingBalance, workspaceId })
}

describe('Workspaces - CRUD and membership', () => {
    it('creates a workspace with the creator as owner', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'ws-create@example.com' })

        const res = await createWorkspace(token, 'Household')

        expect(res.status).toBe(201)
        expect(res.body.success).toBe(true)
        expect(res.body.data.name).toBe('Household')
        expect(res.body.data.ownerId).toBe(userId)
        expect(res.body.data.members).toHaveLength(1)
        expect(res.body.data.members[0].role).toBe('owner')
        expect(res.body.data.members[0].userId).toBe(userId)
    })

    it('lists workspaces where the user is a member', async () => {
        const { token } = await seedUserDirectly({ email: 'ws-list@example.com' })
        const other = await createSecondUser(app)

        await createWorkspace(token, 'Mine')
        const shared = await createWorkspace(other.token, 'Theirs')
        await inviteAndAcceptMember(
            other.token,
            token,
            shared.body.data._id,
            'ws-list@example.com',
            'viewer'
        )

        const res = await request(app).get('/api/v1/workspaces').set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.data).toHaveLength(2)
        expect(res.body.data.map((ws: { name: string }) => ws.name).sort()).toEqual(['Mine', 'Theirs'])
    })

    it('returns 403 for non-members accessing a workspace', async () => {
        const owner = await seedUserDirectly({ email: 'ws-owner@example.com' })
        const outsider = await createSecondUser(app)

        const created = await createWorkspace(owner.token)
        const res = await request(app)
            .get(`/api/v1/workspaces/${created.body.data._id}`)
            .set(authHeader(outsider.token))

        expect(res.status).toBe(403)
    })

    it('allows the owner to invite and remove members', async () => {
        const owner = await seedUserDirectly({ email: 'ws-invite-owner@example.com' })
        const editor = await seedUserDirectly({
            fullName: 'Editor User',
            email: 'ws-invite-editor@example.com',
            password: 'EditorPassword123!',
        })

        const created = await createWorkspace(owner.token)
        const workspaceId = created.body.data._id

        const inviteRes = await sendWorkspaceInvite(
            owner.token,
            workspaceId,
            editor.email,
            'editor'
        )

        expect(inviteRes.status).toBe(201)
        expect(inviteRes.body.data.status).toBe('pending')
        expect(inviteRes.body.data.inviteeUserId).toBe(editor.userId)

        const acceptRes = await acceptWorkspaceInvite(editor.token, inviteRes.body.data._id)
        expect(acceptRes.status).toBe(200)
        expect(acceptRes.body.data.members).toHaveLength(2)

        const removeRes = await request(app)
            .delete(`/api/v1/workspaces/${workspaceId}/members/${editor.userId}`)
            .set(authHeader(owner.token))

        expect(removeRes.status).toBe(200)
        expect(removeRes.body.data.members).toHaveLength(1)
    })

    it('rejects invite for unregistered email', async () => {
        const owner = await seedUserDirectly({ email: 'ws-unregistered@example.com' })
        const created = await createWorkspace(owner.token)

        const res = await sendWorkspaceInvite(
            owner.token,
            created.body.data._id,
            'nobody@example.com',
            'viewer'
        )

        expect(res.status).toBe(404)
    })

    it('creates a notification and supports accept/decline flow', async () => {
        const owner = await seedUserDirectly({ email: 'ws-notify-owner@example.com' })
        const invitee = await seedUserDirectly({
            fullName: 'Invitee User',
            email: 'ws-notify-invitee@example.com',
            password: 'InviteePassword123!',
        })

        const created = await createWorkspace(owner.token, 'Notify Team')
        const workspaceId = created.body.data._id

        const inviteRes = await sendWorkspaceInvite(
            owner.token,
            workspaceId,
            invitee.email,
            'viewer'
        )
        expect(inviteRes.status).toBe(201)

        const notifications = await request(app)
            .get('/api/v1/notifications')
            .set(authHeader(invitee.token))

        expect(notifications.status).toBe(200)
        expect(
            notifications.body.data.notifications.some(
                (entry: { type: string }) => entry.type === 'workspace_invite'
            )
        ).toBe(true)

        const received = await request(app)
            .get('/api/v1/workspaces/invites/received')
            .set(authHeader(invitee.token))

        expect(received.status).toBe(200)
        expect(received.body.data).toHaveLength(1)
        expect(received.body.data[0].workspaceName).toBe('Notify Team')

        const declineRes = await request(app)
            .post(`/api/v1/workspaces/invites/${inviteRes.body.data._id}/decline`)
            .set(authHeader(invitee.token))

        expect(declineRes.status).toBe(200)

        const listAfterDecline = await request(app)
            .get('/api/v1/workspaces')
            .set(authHeader(invitee.token))

        expect(listAfterDecline.body.data).toHaveLength(0)
    })

    it('allows invited members to leave but not the owner', async () => {
        const owner = await seedUserDirectly({ email: 'ws-leave-owner@example.com' })
        const viewer = await seedUserDirectly({
            fullName: 'Viewer User',
            email: 'ws-leave-viewer@example.com',
            password: 'ViewerPassword123!',
        })

        const created = await createWorkspace(owner.token)
        const workspaceId = created.body.data._id

        await inviteAndAcceptMember(
            owner.token,
            viewer.token,
            workspaceId,
            viewer.email,
            'viewer'
        )

        const ownerLeave = await request(app)
            .delete(`/api/v1/workspaces/${workspaceId}/members/${owner.userId}`)
            .set(authHeader(owner.token))

        expect(ownerLeave.status).toBe(400)

        const viewerLeave = await request(app)
            .delete(`/api/v1/workspaces/${workspaceId}/members/${viewer.userId}`)
            .set(authHeader(viewer.token))

        expect(viewerLeave.status).toBe(200)
        expect(viewerLeave.body.data.members).toHaveLength(1)
    })

    it('updates member roles for owner only', async () => {
        const owner = await seedUserDirectly({ email: 'ws-role-owner@example.com' })
        const member = await seedUserDirectly({
            fullName: 'Role User',
            email: 'ws-role-member@example.com',
            password: 'RolePassword123!',
        })

        const created = await createWorkspace(owner.token)
        const workspaceId = created.body.data._id

        await inviteAndAcceptMember(
            owner.token,
            member.token,
            workspaceId,
            member.email,
            'viewer'
        )

        const promote = await request(app)
            .patch(`/api/v1/workspaces/${workspaceId}/members/${member.userId}`)
            .set(authHeader(owner.token))
            .send({ role: 'editor' })

        expect(promote.status).toBe(200)
        expect(
            promote.body.data.members.find(
                (entry: { userId: string }) => entry.userId === member.userId
            ).role
        ).toBe('editor')

        const forbidden = await request(app)
            .patch(`/api/v1/workspaces/${workspaceId}/members/${member.userId}`)
            .set(authHeader(member.token))
            .send({ role: 'viewer' })

        expect(forbidden.status).toBe(403)
    })
})

describe('Workspaces - shared resources and RBAC', () => {
    it('shares accounts, transactions, and budgets within a workspace', async () => {
        const owner = await seedUserDirectly({ email: 'ws-shared-owner@example.com' })
        const editor = await seedUserDirectly({
            fullName: 'Shared Editor',
            email: 'ws-shared-editor@example.com',
            password: 'SharedEditor123!',
        })

        const created = await createWorkspace(owner.token, 'Team Budget')
        const workspaceId = created.body.data._id

        await inviteAndAcceptMember(
            owner.token,
            editor.token,
            workspaceId,
            editor.email,
            'editor'
        )

        const accountRes = await createWorkspaceAccount(owner.token, workspaceId)
        expect(accountRes.status).toBe(201)

        const editorAccounts = await request(app)
            .get('/api/v1/accounts')
            .query({ workspaceId })
            .set(authHeader(editor.token))

        expect(editorAccounts.status).toBe(200)
        expect(editorAccounts.body.data).toHaveLength(1)
        expect(editorAccounts.body.data[0].name).toBe('Shared Checking')

        const foodCategoryId = await getFoodMasterId(editor.token)
        const expenseRes = await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(editor.token))
            .send({
                type: 'expense',
                title: 'Team lunch',
                amount: 25,
                date: '2026-01-15T12:00:00.000Z',
                accountId: accountRes.body.data._id,
                categoryId: foodCategoryId,
                workspaceId,
            })

        expect(expenseRes.status).toBe(201)

        const ownerTransactions = await request(app)
            .get('/api/v1/transactions')
            .query({ workspaceId })
            .set(authHeader(owner.token))

        expect(ownerTransactions.status).toBe(200)
        expect(ownerTransactions.body.data.data).toHaveLength(1)
        expect(ownerTransactions.body.data.data[0].title).toBe('Team lunch')

        const budgetRes = await request(app)
            .post('/api/v1/budgets')
            .set(authHeader(owner.token))
            .send({
                periodType: 'monthly',
                year: 2026,
                month: 1,
                amount: 500,
                workspaceId,
                accountIds: [accountRes.body.data._id],
            })

        expect(budgetRes.status).toBe(201)
        expect(budgetRes.body.data.progress.spent).toBe(25)
    })

    it('keeps personal resources isolated from workspace lists', async () => {
        const { token } = await seedUserDirectly({ email: 'ws-isolation@example.com' })
        const created = await createWorkspace(token)
        const workspaceId = created.body.data._id

        await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Personal', type: 'checking', openingBalance: 100 })

        await createWorkspaceAccount(token, workspaceId, 'Workspace Only', 200)

        const personal = await request(app).get('/api/v1/accounts').set(authHeader(token))
        const shared = await request(app)
            .get('/api/v1/accounts')
            .query({ workspaceId })
            .set(authHeader(token))

        expect(personal.body.data).toHaveLength(1)
        expect(personal.body.data[0].name).toBe('Personal')
        expect(shared.body.data).toHaveLength(1)
        expect(shared.body.data[0].name).toBe('Workspace Only')
    })

    it('blocks viewers from creating workspace resources', async () => {
        const owner = await seedUserDirectly({ email: 'ws-viewer-owner@example.com' })
        const viewer = await seedUserDirectly({
            fullName: 'Read Only',
            email: 'ws-viewer@example.com',
            password: 'ViewerOnly123!',
        })

        const created = await createWorkspace(owner.token)
        const workspaceId = created.body.data._id

        await inviteAndAcceptMember(
            owner.token,
            viewer.token,
            workspaceId,
            viewer.email,
            'viewer'
        )

        const accountAttempt = await createWorkspaceAccount(viewer.token, workspaceId, 'Blocked')
        expect(accountAttempt.status).toBe(403)

        const ownerAccount = await createWorkspaceAccount(owner.token, workspaceId, 'Allowed', 500)
        expect(ownerAccount.status).toBe(201)

        const viewerRead = await request(app)
            .get('/api/v1/accounts')
            .query({ workspaceId })
            .set(authHeader(viewer.token))

        expect(viewerRead.status).toBe(200)
        expect(viewerRead.body.data).toHaveLength(1)
    })

    it('returns 403 when a non-member accesses workspace-scoped resources', async () => {
        const owner = await seedUserDirectly({ email: 'ws-nonmember-owner@example.com' })
        const outsider = await createSecondUser(app)

        const created = await createWorkspace(owner.token)
        const workspaceId = created.body.data._id
        const accountRes = await createWorkspaceAccount(owner.token, workspaceId)

        const res = await request(app)
            .get(`/api/v1/accounts/${accountRes.body.data._id}`)
            .set(authHeader(outsider.token))

        expect(res.status).toBe(403)
    })

    it('rejects mismatched workspace and account on transaction create', async () => {
        const { token } = await seedUserDirectly({ email: 'ws-mismatch@example.com' })
        const created = await createWorkspace(token)
        const workspaceId = created.body.data._id

        const personalAccount = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Personal', type: 'checking', openingBalance: 100 })

        const foodCategoryId = await getFoodMasterId(token)

        const res = await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(token))
            .send({
                type: 'expense',
                title: 'Bad link',
                amount: 10,
                date: '2026-01-15T12:00:00.000Z',
                accountId: personalAccount.body.data._id,
                categoryId: foodCategoryId,
                workspaceId,
            })

        expect(res.status).toBe(400)
    })
})
