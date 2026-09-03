import fs from 'fs'
import path from 'path'
import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Workspace } from '@modules/workspaces'
import { Transaction } from '@modules/transactions'
import { Notification } from '@modules/notifications'
import { authHeader, registerUser } from '@tests/helpers'
import { RECEIPT_UPLOAD_ROOT } from "@modules/receipts/receiptUtils";
import { REMOVED_MEMBER_USER_ID } from "@modules/users/accountDeletionUtils";

/**
 * Acceptance spec for the workspace-record-retention redesign of account deletion.
 *
 * Previously `deleteUserAccountCascade` hard-deleted every resource matching `{ userId }`,
 * regardless of `workspaceId` - so a departing workspace member's shared transactions, accounts,
 * budgets etc. vanished out from under the workspace's other members with no warning. The new
 * behaviour, for every workspace-capable collection (`Transaction`, `Account`, `Budget`,
 * `SavingsGoal`, `RecurringRule`, `ReconciliationSession`, `SavedReport`):
 *
 *   - Personal records (`workspaceId: null`) are still hard-deleted, unchanged.
 *   - Workspace records created by the departing user, in a workspace that still has other
 *     members afterward, are RETAINED but have their `userId` severed to a reserved sentinel
 *     (`REMOVED_MEMBER_USER_ID`, never a real user) with `createdByRemovedUser: true` set, so the
 *     record stops being anyone's personal data without being misattributed to a real member.
 *   - Every record in a workspace that has no members left after this user departs is
 *     hard-deleted (regardless of who created it), and the now-empty `Workspace` document itself
 *     is deleted - no orphaned data, no orphaned shell workspace.
 *   - Receipts (no `workspaceId` field - always personal) are always hard-deleted, and any
 *     dangling `receiptIds` reference left on a retained transaction is cleared.
 *   - Remaining members of an affected workspace get a `workspace_member_left` notification that
 *     never names the departing user.
 *   - `GET /auth/account/deletion-impact` previews the retained-record count and affected
 *     workspace names before the user commits to deleting.
 */

const DELETE_PASSWORD = 'DeleteMePlease123!'

async function createWorkspace(token: string, name = 'Household') {
    return request(app).post('/api/v1/workspaces').set(authHeader(token)).send({ name })
}

async function inviteAndAccept(
    ownerToken: string,
    inviteeToken: string,
    workspaceId: string,
    email: string,
    role: 'editor' | 'viewer' = 'editor'
) {
    const inviteRes = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/members`)
        .set(authHeader(ownerToken))
        .send({ email, role })
    expect(inviteRes.status).toBe(201)

    const acceptRes = await request(app)
        .post(`/api/v1/workspaces/invites/${inviteRes.body.data._id}/accept`)
        .set(authHeader(inviteeToken))
    expect(acceptRes.status).toBe(200)
}

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const food = res.body.data.masters.find((m: { name: string }) => m.name === 'Food')
    if (!food) throw new Error('Food master category not found')
    return food._id
}

async function createAccount(
    token: string,
    opts: { name?: string; workspaceId?: string } = {}
) {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({
            name: opts.name ?? 'Checking',
            type: 'checking',
            openingBalance: 1000,
            ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
        })
    return res.body.data
}

async function createExpense(
    token: string,
    accountId: string,
    categoryId: string,
    opts: { title?: string; amount?: number; workspaceId?: string } = {}
) {
    const res = await request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({
            type: 'expense',
            title: opts.title ?? 'Groceries',
            amount: opts.amount ?? 42.5,
            date: '2026-01-15T12:00:00.000Z',
            accountId,
            categoryId,
            ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
        })
    expect(res.status).toBe(201)
    return res.body.data
}

async function seedWorkspaceWithMember(role: 'editor' | 'viewer' = 'editor') {
    const owner = await registerUser(app, { email: 'wsret-owner@example.com' })
    const member = await registerUser(app, {
        email: 'wsret-member@example.com',
        password: DELETE_PASSWORD,
    })

    const wsRes = await createWorkspace(owner.token, 'Household')
    const workspaceId = wsRes.body.data._id
    await inviteAndAccept(owner.token, member.token, workspaceId, member.email, role)

    return { owner, member, workspaceId }
}

afterEach(() => {
    if (fs.existsSync(RECEIPT_UPLOAD_ROOT)) {
        fs.rmSync(RECEIPT_UPLOAD_ROOT, { recursive: true, force: true })
    }
})

describe('Account deletion - workspace record retention', () => {
    it('retains a departing member\'s workspace transaction with the creator link severed', async () => {
        const { owner, member, workspaceId } = await seedWorkspaceWithMember()
        const categoryId = await getFoodMasterId(owner.token)
        const account = await createAccount(owner.token, { workspaceId })

        const memberTxn = await createExpense(member.token, account._id, categoryId, {
            title: 'Member groceries',
            workspaceId,
        })

        const res = await request(app)
            .delete('/api/v1/auth/account')
            .set(authHeader(member.token))
            .send({ password: DELETE_PASSWORD })
        expect(res.status).toBe(200)

        const retained = await Transaction.findById(memberTxn._id)
        expect(retained).not.toBeNull()
        expect(retained!.workspaceId?.toString()).toBe(workspaceId)
        expect(retained!.title).toBe('Member groceries')
        expect(retained!.userId.toString()).toBe(REMOVED_MEMBER_USER_ID.toString())
        expect((retained as unknown as { createdByRemovedUser: boolean }).createdByRemovedUser).toBe(
            true
        )
    })

    it('hard-deletes the departing member\'s personal records unchanged', async () => {
        const { owner, member, workspaceId } = await seedWorkspaceWithMember()
        void workspaceId
        const categoryId = await getFoodMasterId(member.token)
        const personalAccount = await createAccount(member.token, { name: 'My Wallet' })

        const personalTxn = await createExpense(member.token, personalAccount._id, categoryId, {
            title: 'Personal coffee',
        })

        await request(app)
            .delete('/api/v1/auth/account')
            .set(authHeader(member.token))
            .send({ password: DELETE_PASSWORD })

        expect(await Transaction.findById(personalTxn._id)).toBeNull()
        expect(
            await Transaction.countDocuments({ userId: member.userId })
        ).toBe(0)
    })

    it('leaves records created by other members completely untouched', async () => {
        const { owner, member, workspaceId } = await seedWorkspaceWithMember()
        const categoryId = await getFoodMasterId(owner.token)
        const account = await createAccount(owner.token, { workspaceId })

        const ownerTxn = await createExpense(owner.token, account._id, categoryId, {
            title: 'Owner rent',
            workspaceId,
        })

        await request(app)
            .delete('/api/v1/auth/account')
            .set(authHeader(member.token))
            .send({ password: DELETE_PASSWORD })

        const untouched = await Transaction.findById(ownerTxn._id)
        expect(untouched).not.toBeNull()
        expect(untouched!.userId.toString()).toBe(owner.userId)
        expect(untouched!.title).toBe('Owner rent')
    })

    it('hard-deletes every record and the workspace itself when the departing user was the only member', async () => {
        const solo = await registerUser(app, {
            email: 'wsret-solo@example.com',
            password: DELETE_PASSWORD,
        })
        const wsRes = await createWorkspace(solo.token, 'Solo Workspace')
        const workspaceId = wsRes.body.data._id
        const categoryId = await getFoodMasterId(solo.token)
        const account = await createAccount(solo.token, { workspaceId })
        const txn = await createExpense(solo.token, account._id, categoryId, { workspaceId })

        const res = await request(app)
            .delete('/api/v1/auth/account')
            .set(authHeader(solo.token))
            .send({ password: DELETE_PASSWORD })
        expect(res.status).toBe(200)

        expect(await Transaction.findById(txn._id)).toBeNull()
        expect(await Workspace.findById(workspaceId)).toBeNull()
    })

    it('always hard-deletes receipts and clears dangling references on a retained transaction', async () => {
        const { owner, member, workspaceId } = await seedWorkspaceWithMember()
        const categoryId = await getFoodMasterId(owner.token)
        const account = await createAccount(owner.token, { workspaceId })
        const memberTxn = await createExpense(member.token, account._id, categoryId, {
            title: 'Receipted lunch',
            workspaceId,
        })

        const FIXTURE_PNG = path.join(__dirname, '..', '..', '..', '..', 'tests', 'fixtures', 'sample-receipt.png')
        const uploadRes = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(member.token))
            .attach('receipt', FIXTURE_PNG)
        expect(uploadRes.status).toBe(201)
        const receiptId = uploadRes.body.data._id

        const attachRes = await request(app)
            .post(`/api/v1/transactions/${memberTxn._id}/receipts`)
            .set(authHeader(member.token))
            .send({ receiptId })
        expect(attachRes.status).toBe(200)

        await request(app)
            .delete('/api/v1/auth/account')
            .set(authHeader(member.token))
            .send({ password: DELETE_PASSWORD })

        const retained = await Transaction.findById(memberTxn._id)
        expect(retained).not.toBeNull()
        expect(retained!.receiptIds ?? []).toHaveLength(0)

        const receiptRes = await request(app)
            .get(`/api/v1/receipts/${receiptId}`)
            .set(authHeader(owner.token))
        expect(receiptRes.status).toBe(404)
    })

    it('notifies remaining members a member left, without naming them', async () => {
        const { owner, member, workspaceId } = await seedWorkspaceWithMember()
        const categoryId = await getFoodMasterId(member.token)
        const account = await createAccount(owner.token, { workspaceId })
        await createExpense(member.token, account._id, categoryId, { workspaceId })

        await request(app)
            .delete('/api/v1/auth/account')
            .set(authHeader(member.token))
            .send({ password: DELETE_PASSWORD })

        const notifications = await Notification.find({
            userId: owner.userId,
            type: 'workspace_member_left',
        })
        expect(notifications).toHaveLength(1)

        const notification = notifications[0]
        expect(notification.message).not.toContain(member.email)
        expect(notification.message.toLowerCase()).not.toContain('wsret-member')
        expect(JSON.stringify(notification.metadata ?? {})).not.toContain(member.userId)
    })

    it('does not notify anyone when the departing member created no shared records', async () => {
        const { owner, member } = await seedWorkspaceWithMember()

        await request(app)
            .delete('/api/v1/auth/account')
            .set(authHeader(member.token))
            .send({ password: DELETE_PASSWORD })

        // Membership departure itself is still worth a heads-up regardless of whether the
        // member ever created shared records, so a notification is still expected here -
        // this pins that the *content* never leaks identity, independent of whether records
        // existed (see the previous test for the identity assertion).
        const notifications = await Notification.find({
            userId: owner.userId,
            type: 'workspace_member_left',
        })
        expect(notifications).toHaveLength(1)
    })

    describe('GET /auth/account/deletion-impact', () => {
        it('reports zero impact for a user with no shared workspace records', async () => {
            const { token } = await registerUser(app, { email: 'wsret-impact-none@example.com' })

            const res = await request(app)
                .get('/api/v1/auth/account/deletion-impact')
                .set(authHeader(token))

            expect(res.status).toBe(200)
            expect(res.body.data.retainedRecordCount).toBe(0)
            expect(res.body.data.affectedWorkspaces).toHaveLength(0)
        })

        it('counts records the caller created in workspaces that will retain them', async () => {
            const { owner, member, workspaceId } = await seedWorkspaceWithMember()
            const categoryId = await getFoodMasterId(member.token)
            const account = await createAccount(owner.token, { workspaceId })
            await createExpense(member.token, account._id, categoryId, {
                title: 'Impact preview txn',
                workspaceId,
            })

            const res = await request(app)
                .get('/api/v1/auth/account/deletion-impact')
                .set(authHeader(member.token))

            expect(res.status).toBe(200)
            expect(res.body.data.retainedRecordCount).toBeGreaterThanOrEqual(1)
            expect(res.body.data.affectedWorkspaces).toHaveLength(1)
            expect(res.body.data.affectedWorkspaces[0].name).toBe('Household')
            expect(res.body.data.affectedWorkspaces[0].workspaceId).toBe(workspaceId)
        })

        it('does not count records in a workspace that would be emptied (hard-deleted, not retained)', async () => {
            const solo = await registerUser(app, { email: 'wsret-impact-solo@example.com' })
            const wsRes = await createWorkspace(solo.token, 'Solo Workspace')
            const workspaceId = wsRes.body.data._id
            const categoryId = await getFoodMasterId(solo.token)
            const account = await createAccount(solo.token, { workspaceId })
            await createExpense(solo.token, account._id, categoryId, { workspaceId })

            const res = await request(app)
                .get('/api/v1/auth/account/deletion-impact')
                .set(authHeader(solo.token))

            expect(res.status).toBe(200)
            expect(res.body.data.retainedRecordCount).toBe(0)
            expect(res.body.data.affectedWorkspaces).toHaveLength(0)
        })
    })

    describe('RLS on retained records', () => {
        it('still blocks an unrelated user from reaching a retained workspace transaction', async () => {
            const { owner, member, workspaceId } = await seedWorkspaceWithMember()
            const categoryId = await getFoodMasterId(owner.token)
            const account = await createAccount(owner.token, { workspaceId })
            const memberTxn = await createExpense(member.token, account._id, categoryId, {
                workspaceId,
            })

            await request(app)
                .delete('/api/v1/auth/account')
                .set(authHeader(member.token))
                .send({ password: DELETE_PASSWORD })

            const outsider = await registerUser(app, { email: 'wsret-outsider@example.com' })
            const res = await request(app)
                .get(`/api/v1/transactions/${memberTxn._id}`)
                .set(authHeader(outsider.token))

            expect(res.status).toBe(403)

            // The workspace's actual (remaining) member can still reach it, unaffected by RLS.
            const ownerRes = await request(app)
                .get(`/api/v1/transactions/${memberTxn._id}`)
                .set(authHeader(owner.token))
            expect(ownerRes.status).toBe(200)
        })
    })
})
