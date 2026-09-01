import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import User from '../models/User'
import Account from '../models/Account'
import Transaction from '../models/Transaction'
import Category from '../models/Category'
import RefreshToken from '../models/RefreshToken'
import { authHeader, registerUser } from './helpers'

/**
 * Acceptance spec for self-service account deletion and data export (L7).
 *
 * Neither self-service account deletion nor a dedicated export entry point exists today.
 * Contract assumed here:
 *
 *   Data export: the full-fidelity JSON export already built for backup/restore
 *   (`GET /api/v1/backup/export`, covered end-to-end by `tests/backup.test.ts`) *is* the
 *   self-service export mechanism L7 asks for - it already dumps every user-owned collection as
 *   portable JSON. This spec does not re-prove its contents (that's `backup.test.ts`'s job); it
 *   only pins that the endpoint is reachable by an ordinary authenticated user ahead of deletion,
 *   anchoring the "export before you delete" flow the frontend is expected to offer.
 *
 *   Account deletion: `DELETE /api/v1/auth/account`, `protect`-gated, body `{ password: string }`
 *   requiring the caller to reconfirm their current password (an irreversible action should not
 *   be reachable from a bare stolen/leaked access token alone). On success it:
 *     - Verifies the password via `user.comparePassword`; a wrong password is rejected (400/401)
 *       and nothing is deleted.
 *     - Hard-deletes every resource scoped to that `userId` (Transaction, Account, Category
 *       (custom only - shared `userId: null` master categories are untouched), Receipt and its
 *       stored file, Budget, SavingsGoal, RecurringRule, Tag, CategorizationRule,
 *       TransactionTemplate, Notification, RefreshToken) and the `User` document itself. This is
 *       a genuine erasure, not a soft-delete tombstone - GDPR-style deletion, distinct from the
 *       sync layer's `deletedAt` tombstones used for multi-device propagation.
 *     - Revokes every refresh token and clears the refresh cookie, so both the access token that
 *       made the request and any other outstanding session die immediately.
 *     - Is blocked (409) if the caller is the sole owner of a workspace that still has other
 *       members - ownership must be transferred (or the workspace deleted) first, so deleting
 *       one account can never silently orphan or destroy other members' shared data.
 *     - Leaves every other user's data - and shared master categories - completely untouched.
 */

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const food = res.body.data.masters.find((m: { name: string }) => m.name === 'Food')
    if (!food) throw new Error('Food master category not found')
    return food._id
}

async function createAccount(token: string, name = 'Checking') {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'checking', openingBalance: 1000 })
    return res.body.data
}

async function createExpense(token: string, accountId: string, categoryId: string) {
    return request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({
            type: 'expense',
            title: 'Groceries',
            amount: 42.5,
            date: '2026-01-15T12:00:00.000Z',
            accountId,
            categoryId,
        })
}

async function createWorkspace(token: string, name = 'Shared Finances') {
    return request(app).post('/api/v1/workspaces').set(authHeader(token)).send({ name })
}

async function inviteAndAccept(ownerToken: string, inviteeToken: string, workspaceId: string, email: string) {
    const inviteRes = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/members`)
        .set(authHeader(ownerToken))
        .send({ email, role: 'editor' })
    expect(inviteRes.status).toBe(201)

    return request(app)
        .post(`/api/v1/workspaces/invites/${inviteRes.body.data._id}/accept`)
        .set(authHeader(inviteeToken))
}

const DELETE_PASSWORD = 'DeleteMePlease123!'

describe('Self-service data export (L7)', () => {
    it('lets an ordinary authenticated user reach the full-data export ahead of deletion', async () => {
        const { token } = await registerUser(app, { email: 'export-before-delete@example.com' })

        const res = await request(app).get('/api/v1/backup/export').set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toMatch(/application\/json/)
        expect(res.body.exportedAt).toBeTruthy()
    })
})

describe('Self-service account deletion (L7)', () => {
    it('rejects deletion without authentication', async () => {
        const res = await request(app).delete('/api/v1/auth/account').send({ password: DELETE_PASSWORD })
        expect(res.status).toBe(401)
    })

    it('rejects deletion with the wrong password and deletes nothing', async () => {
        const { token, userId } = await registerUser(app, {
            email: 'delete-wrong-password@example.com',
            password: DELETE_PASSWORD,
        })

        const res = await request(app)
            .delete('/api/v1/auth/account')
            .set(authHeader(token))
            .send({ password: 'NotTheRightPassword1!' })

        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(res.status).toBeLessThan(500)

        const stillExists = await User.findById(userId)
        expect(stillExists).not.toBeNull()
    })

    it('deletes the user document and every resource they own on the correct password', async () => {
        const { token, userId } = await registerUser(app, {
            email: 'delete-cascade@example.com',
            password: DELETE_PASSWORD,
        })
        const categoryId = await getFoodMasterId(token)
        const account = await createAccount(token)
        await createExpense(token, account._id, categoryId)

        const res = await request(app)
            .delete('/api/v1/auth/account')
            .set(authHeader(token))
            .send({ password: DELETE_PASSWORD })

        expect(res.status).toBe(200)

        expect(await User.findById(userId)).toBeNull()
        expect(await Account.countDocuments({ userId })).toBe(0)
        expect(await Transaction.countDocuments({ userId })).toBe(0)
        // SEC-49: refresh tokens are hard-deleted, not just flagged revoked - no userId-linked
        // rows survive the account.
        expect(await RefreshToken.countDocuments({ userId })).toBe(0)
    })

    it('hard-deletes refresh tokens on account deletion rather than leaving revoked rows (SEC-49)', async () => {
        const { token, userId } = await registerUser(app, {
            email: 'delete-refresh-tokens@example.com',
            password: DELETE_PASSWORD,
        })

        // A second session and a rotation, so there are both active and already-revoked rows.
        await request(app).post('/api/v1/auth/login').send({
            email: 'delete-refresh-tokens@example.com',
            password: DELETE_PASSWORD,
        })
        expect(await RefreshToken.countDocuments({ userId })).toBeGreaterThan(0)

        const res = await request(app)
            .delete('/api/v1/auth/account')
            .set(authHeader(token))
            .send({ password: DELETE_PASSWORD })

        expect(res.status).toBe(200)
        expect(await RefreshToken.countDocuments({ userId })).toBe(0)
    })

    it('leaves shared master categories (userId: null) untouched', async () => {
        const { token, userId } = await registerUser(app, {
            email: 'delete-shared-categories@example.com',
            password: DELETE_PASSWORD,
        })
        await getFoodMasterId(token)

        const mastersBefore = await Category.countDocuments({ userId: null })
        expect(mastersBefore).toBeGreaterThan(0)

        await request(app).delete('/api/v1/auth/account').set(authHeader(token)).send({ password: DELETE_PASSWORD })

        const mastersAfter = await Category.countDocuments({ userId: null })
        expect(mastersAfter).toBe(mastersBefore)
        expect(await User.findById(userId)).toBeNull()
    })

    it('does not touch another user\'s data', async () => {
        const survivor = await registerUser(app, { email: 'delete-survivor@example.com' })
        const survivorCategoryId = await getFoodMasterId(survivor.token)
        const survivorAccount = await createAccount(survivor.token, 'Survivor Checking')
        await createExpense(survivor.token, survivorAccount._id, survivorCategoryId)

        const { token } = await registerUser(app, {
            email: 'delete-does-not-leak@example.com',
            password: DELETE_PASSWORD,
        })

        await request(app).delete('/api/v1/auth/account').set(authHeader(token)).send({ password: DELETE_PASSWORD })

        expect(await Account.countDocuments({ userId: survivor.userId })).toBe(1)
        expect(await Transaction.countDocuments({ userId: survivor.userId })).toBe(1)
        expect(await User.findById(survivor.userId)).not.toBeNull()
    })

    it('revokes the requesting session so the deleting access token no longer authorizes anything', async () => {
        const { token } = await registerUser(app, {
            email: 'delete-revokes-self@example.com',
            password: DELETE_PASSWORD,
        })

        await request(app).delete('/api/v1/auth/account').set(authHeader(token)).send({ password: DELETE_PASSWORD })

        const res = await request(app).get('/api/v1/auth/user').set(authHeader(token))
        expect(res.status).toBe(401)
    })

    it('blocks deletion when the caller is the sole owner of a workspace with other members', async () => {
        const owner = await registerUser(app, { email: 'delete-owner@example.com', password: DELETE_PASSWORD })
        const member = await registerUser(app, { email: 'delete-owner-member@example.com' })

        const wsRes = await createWorkspace(owner.token, 'Household')
        expect(wsRes.status).toBe(201)
        await inviteAndAccept(owner.token, member.token, wsRes.body.data._id, member.email)

        const res = await request(app)
            .delete('/api/v1/auth/account')
            .set(authHeader(owner.token))
            .send({ password: DELETE_PASSWORD })

        expect(res.status).toBe(409)
        expect(await User.findById(owner.userId)).not.toBeNull()
    })

    it('allows deletion for a workspace member who is not the sole owner, without deleting the workspace', async () => {
        const owner = await registerUser(app, { email: 'delete-nonowner-owner@example.com' })
        const member = await registerUser(app, {
            email: 'delete-nonowner-member@example.com',
            password: DELETE_PASSWORD,
        })

        const wsRes = await createWorkspace(owner.token, 'Household')
        await inviteAndAccept(owner.token, member.token, wsRes.body.data._id, member.email)

        const res = await request(app)
            .delete('/api/v1/auth/account')
            .set(authHeader(member.token))
            .send({ password: DELETE_PASSWORD })

        expect(res.status).toBe(200)
        expect(await User.findById(member.userId)).toBeNull()
        expect(await User.findById(owner.userId)).not.toBeNull()

        const wsCheck = await request(app)
            .get(`/api/v1/workspaces/${wsRes.body.data._id}`)
            .set(authHeader(owner.token))
        expect(wsCheck.status).toBe(200)
    })
})
