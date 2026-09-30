import request from 'supertest'
import { describe, expect, it } from 'vitest'

import app from '@http/app'
import { Workspace, WorkspaceInvite } from '@modules/workspaces'
import { recomputeWorkspaceSeats } from '@modules/billing'
import { authHeader, registerUser } from '@tests/helpers'
import { randomId, seedPendingInvite, seedWorkspace } from '@tests/billingHelpers'

/**
 * BUG-52 - the erasure cascade drops the user's workspace membership and their invites without giving
 * the seats back, so `Workspace.seatCount` stays inflated for the workspaces that carry on.
 */

const PASSWORD = 'DeleteMeSeats123!'

const deleteAccount = (token: string) => request(app).delete('/api/v1/auth/account').set(authHeader(token)).send({ password: PASSWORD })

const seats = async (workspaceId: string) => (await Workspace.findById(workspaceId))?.seatCount

describe('account deletion and workspace seats', () => {
    it('releases the seat of a departing member', async () => {
        const owner = await registerUser(app, { email: 'seat-owner-1@example.com', password: PASSWORD })
        const member = await registerUser(app, { email: 'seat-member-1@example.com', password: PASSWORD })
        const workspaceId = await seedWorkspace(owner.userId, [{ userId: member.userId, role: 'editor' }])
        await recomputeWorkspaceSeats(workspaceId)
        expect(await seats(workspaceId)).toBe(2)

        expect((await deleteAccount(member.token)).status).toBe(200)

        expect(await seats(workspaceId)).toBe(1)
    })

    it('releases the seat held by a pending invite addressed to the deleted user', async () => {
        const owner = await registerUser(app, { email: 'seat-owner-2@example.com', password: PASSWORD })
        const invitee = await registerUser(app, { email: 'seat-invitee-2@example.com', password: PASSWORD })
        const workspaceId = await seedWorkspace(owner.userId)
        await seedPendingInvite(workspaceId, owner.userId, invitee.userId)
        await recomputeWorkspaceSeats(workspaceId)
        expect(await seats(workspaceId)).toBe(2)

        expect((await deleteAccount(invitee.token)).status).toBe(200)

        expect(await WorkspaceInvite.countDocuments({ workspaceId })).toBe(0)
        expect(await seats(workspaceId)).toBe(1)
    })

    it('releases the seats of the member and of the invites they had sent', async () => {
        const owner = await registerUser(app, { email: 'seat-owner-3@example.com', password: PASSWORD })
        const member = await registerUser(app, { email: 'seat-member-3@example.com', password: PASSWORD })
        const workspaceId = await seedWorkspace(owner.userId, [{ userId: member.userId, role: 'editor' }])
        await seedPendingInvite(workspaceId, member.userId, randomId())
        await recomputeWorkspaceSeats(workspaceId)
        expect(await seats(workspaceId)).toBe(3)

        expect((await deleteAccount(member.token)).status).toBe(200)

        expect(await seats(workspaceId)).toBe(1)
    })

    it('leaves the seat count of an unrelated workspace alone', async () => {
        const owner = await registerUser(app, { email: 'seat-owner-4@example.com', password: PASSWORD })
        const bystander = await registerUser(app, { email: 'seat-bystander-4@example.com', password: PASSWORD })
        const stranger = await registerUser(app, { email: 'seat-stranger-4@example.com', password: PASSWORD })
        const workspaceId = await seedWorkspace(owner.userId, [{ userId: bystander.userId, role: 'viewer' }])
        await recomputeWorkspaceSeats(workspaceId)

        expect((await deleteAccount(stranger.token)).status).toBe(200)

        expect(await seats(workspaceId)).toBe(2)
    })
})
