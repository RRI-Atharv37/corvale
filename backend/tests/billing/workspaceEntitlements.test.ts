import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { Transaction } from '@modules/transactions'
import { getWorkspaceEntitlements } from '@modules/billing'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { authHeader, registerUser, seedUserDirectly, type RegisteredUser } from '@tests/helpers'
import {
    BILLING_STATES,
    READ_ONLY_STATES,
    createAccountViaApi,
    createExpenseViaApi,
    disableBilling,
    enableBilling,
    getFoodMasterId,
    removeSubscription,
    seedPendingInvite,
    seedTestPlans,
    seedWorkspace,
    setSubscription,
} from '@tests/billingHelpers'

/**
 * M1 / M2c - workspace resources resolve entitlement against the workspace OWNER's subscription,
 * never the acting member's (ROADMAP risk #5, "the likeliest source of subtle bugs"). A viewer or
 * editor on a Pro workspace needs no plan of their own; a lapsed owner freezes the workspace for
 * everyone without touching any member's personal data. RBAC is unchanged and still runs.
 *
 * "Workspace-scoped" means the target resource belongs to a workspace - established from the
 * resource itself, never from a client-supplied `workspaceId` alone (see the borrowed-scope test).
 */

let owner: RegisteredUser
let editor: RegisteredUser
let viewer: RegisteredUser
let workspaceId: string
let workspaceAccountId: string
let categoryId: string
let txToDelete: string

const workspaceExpense = (token: string, title = 'Team dinner') =>
    createExpenseViaApi(app, token, workspaceAccountId, categoryId, { workspaceId, title })

const personalAccount = (token: string, name = 'Mine') =>
    request(app).post('/api/v1/accounts').set(authHeader(token)).send({ name, type: 'checking', openingBalance: 1 })

beforeEach(async () => {
    enableBilling()
    await seedTestPlans()

    owner = await registerUser(app)
    editor = await seedUserDirectly({ email: 'ws-editor@example.com' })
    viewer = await seedUserDirectly({ email: 'ws-viewer@example.com' })
    await setSubscription(owner.userId, BILLING_STATES.active)
    await setSubscription(editor.userId, BILLING_STATES.active)
    await removeSubscription(viewer.userId)

    workspaceId = await seedWorkspace(owner.userId, [
        { userId: editor.userId, role: 'editor' },
        { userId: viewer.userId, role: 'viewer' },
    ])
    workspaceAccountId = await createAccountViaApi(app, owner.token, { workspaceId })
    categoryId = await getFoodMasterId(app, owner.token)
    await workspaceExpense(owner.token, 'Existing A')
    txToDelete = (await workspaceExpense(owner.token, 'Existing B')).body.data._id
})

afterEach(() => disableBilling())

describe('getWorkspaceEntitlements', () => {
    it("returns the owner's entitlements, whoever is asking", async () => {
        await setSubscription(editor.userId, BILLING_STATES.trial_expired)

        const e = await getWorkspaceEntitlements(workspaceId)

        expect(e.planCode).toBe('pro')
        expect(e.status).toBe('active')
        expect(e.canWrite).toBe(true)
        expect(e.features.workspaces).toBe(true)
    })

    it('follows the owner into a lapsed state', async () => {
        await setSubscription(owner.userId, BILLING_STATES.trial_expired)

        const e = await getWorkspaceEntitlements(workspaceId)

        expect(e.status).toBe('trial_expired')
        expect(e.canWrite).toBe(false)
    })
})

describe('members need no plan of their own', () => {
    it("an editor whose own trial has expired can still write to the owner's Pro workspace", async () => {
        await setSubscription(editor.userId, BILLING_STATES.trial_expired)

        const res = await workspaceExpense(editor.token)

        expect(res.status).toBe(201)
    })

    it('...but their own personal data is still read-only', async () => {
        await setSubscription(editor.userId, BILLING_STATES.trial_expired)

        const res = await personalAccount(editor.token)

        expect(res.status).toBe(402)
        expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.READ_ONLY)
    })

    it('an editor with no subscription row at all can still write to the workspace', async () => {
        await removeSubscription(editor.userId)

        expect((await workspaceExpense(editor.token)).status).toBe(201)
    })

    it('a viewer with no plan reads the workspace freely', async () => {
        const list = await request(app).get('/api/v1/transactions').query({ workspaceId }).set(authHeader(viewer.token))

        expect(list.status).toBe(200)
        expect(JSON.stringify(list.body)).toContain('Existing A')
    })

    it('a viewer is still refused writes by RBAC (403), not by billing (402)', async () => {
        const res = await workspaceExpense(viewer.token)

        expect(res.status).toBe(403)
    })

    it('a plan-less user can accept an invite and then read the workspace', async () => {
        const invitee = await seedUserDirectly({ email: 'ws-invitee@example.com' })
        await removeSubscription(invitee.userId)
        const inviteId = await seedPendingInvite(workspaceId, owner.userId, invitee.userId, 'viewer')

        const accept = await request(app).post(`/api/v1/workspaces/invites/${inviteId}/accept`).set(authHeader(invitee.token))
        const read = await request(app).get(`/api/v1/workspaces/${workspaceId}`).set(authHeader(invitee.token))

        expect(accept.status).toBe(200)
        expect(read.status).toBe(200)
    })
})

describe("a lapsed owner freezes the workspace for everyone, and only the workspace", () => {
    it.each(READ_ONLY_STATES)('owner %s: a paying editor cannot write to the workspace', async (state) => {
        await setSubscription(owner.userId, BILLING_STATES[state])

        const res = await workspaceExpense(editor.token)

        expect(res.status).toBe(402)
        expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.READ_ONLY)
    })

    it("the editor's personal data is untouched by the owner's state", async () => {
        await setSubscription(owner.userId, BILLING_STATES.trial_expired)

        expect((await personalAccount(editor.token)).status).toBe(201)
    })

    it('the owner cannot write to their own frozen workspace either', async () => {
        await setSubscription(owner.userId, BILLING_STATES.cancelled)

        expect((await workspaceExpense(owner.token)).status).toBe(402)
    })

    it('every member can still read it', async () => {
        await setSubscription(owner.userId, BILLING_STATES.trial_expired)

        for (const who of [owner, editor, viewer]) {
            const res = await request(app).get('/api/v1/transactions').query({ workspaceId }).set(authHeader(who.token))
            expect(res.status).toBe(200)
        }
    })

    it('by-id writes on existing workspace records are frozen too', async () => {
        await setSubscription(owner.userId, BILLING_STATES.trial_expired)

        const res = await request(app)
            .delete(`/api/v1/transactions/${txToDelete}`)
            .query({ workspaceId })
            .set(authHeader(editor.token))

        expect(res.status).toBe(402)
        expect(await Transaction.countDocuments({ _id: txToDelete })).toBe(1)
    })

    it('by-id writes work while the owner is in good standing, whatever the editor holds', async () => {
        await setSubscription(editor.userId, BILLING_STATES.trial_expired)

        const res = await request(app)
            .delete(`/api/v1/transactions/${txToDelete}`)
            .query({ workspaceId })
            .set(authHeader(editor.token))

        expect(res.status).toBe(200)
    })

    it('workspace management (invite, rename) is refused for a lapsed owner', async () => {
        await setSubscription(owner.userId, BILLING_STATES.trial_expired)
        const invitee = await seedUserDirectly({ email: 'ws-late@example.com' })

        const invite = await request(app)
            .post(`/api/v1/workspaces/${workspaceId}/members`)
            .set(authHeader(owner.token))
            .send({ email: invitee.email, role: 'viewer' })
        const rename = await request(app)
            .patch(`/api/v1/workspaces/${workspaceId}`)
            .set(authHeader(owner.token))
            .send({ name: 'Nope' })

        expect([invite.status, rename.status]).toEqual([402, 402])
    })

    it('the owner regaining a subscription unfreezes the workspace on the next request', async () => {
        await setSubscription(owner.userId, BILLING_STATES.trial_expired)
        expect((await workspaceExpense(editor.token)).status).toBe(402)

        await setSubscription(owner.userId, BILLING_STATES.active)

        expect((await workspaceExpense(editor.token)).status).toBe(201)
    })

    it('a free_forever owner never freezes their workspace', async () => {
        await setSubscription(owner.userId, { ...BILLING_STATES.trial_expired, grandfatherKind: 'free_forever' })

        expect((await workspaceExpense(editor.token)).status).toBe(201)
    })

    it('a trialing owner (trial plan) runs a fully working workspace', async () => {
        await setSubscription(owner.userId, BILLING_STATES.trialing)

        expect((await workspaceExpense(editor.token)).status).toBe(201)
    })
})

describe('workspace-scoped sync', () => {
    let n = 0
    const pushToWorkspace = (token: string, deviceId?: string) =>
        request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(token))
            .send({
                workspaceId,
                ...(deviceId ? { deviceId } : {}),
                ops: [
                    {
                        opId: `ws-op-${(n += 1)}`,
                        entity: 'account',
                        operation: 'create',
                        payload: { name: `Shared ${n}`, type: 'checking', openingBalance: 1 },
                    },
                ],
            })

    it("an editor's push is governed by the owner's subscription, not their own", async () => {
        await setSubscription(editor.userId, BILLING_STATES.trial_expired)

        expect((await pushToWorkspace(editor.token)).status).toBe(200)
    })

    it('a lapsed owner blocks workspace pushes but not workspace pulls', async () => {
        await setSubscription(owner.userId, BILLING_STATES.trial_expired)

        expect((await pushToWorkspace(editor.token)).status).toBe(402)
        const pull = await request(app).get('/api/v1/sync/pull').query({ workspaceId }).set(authHeader(editor.token))
        expect(pull.status).toBe(200)
    })
})

describe('the workspace scope cannot be borrowed', () => {
    it("a lapsed user cannot write their PERSONAL data by naming a workspace they belong to", async () => {
        const personalAcct = await createAccountViaApi(app, editor.token)
        const personalTx = (await createExpenseViaApi(app, editor.token, personalAcct, categoryId, { title: 'Mine' })).body.data._id
        await setSubscription(editor.userId, BILLING_STATES.trial_expired)

        const attempt = await request(app)
            .delete(`/api/v1/transactions/${personalTx}`)
            .query({ workspaceId })
            .set(authHeader(editor.token))

        expect(attempt.status).toBeGreaterThanOrEqual(400)
        expect(await Transaction.countDocuments({ _id: personalTx })).toBe(1)
    })
})
