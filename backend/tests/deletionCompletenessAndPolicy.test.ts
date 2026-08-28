import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'
import { Types } from 'mongoose'
import request from 'supertest'
import app from '../app'
import User from '../models/User'
import SyncOperation from '../models/SyncOperation'
import WorkspaceInvite from '../models/WorkspaceInvite'
import { authHeader, registerUser } from './helpers'

/**
 * Acceptance spec for the deletion-completeness and policy-wording half of Sprint S25 (SEC-33).
 *
 * `deleteUserAccountCascade` was thorough but missed two collections keyed to the deleted
 * `userId`, both covered by the published privacy policy's "erases your account and every
 * private record attached to it" claim:
 *
 *   - `WorkspaceInvite` — never imported into `accountDeletionUtils.ts`. Invites the user sent
 *     or received stayed `pending` forever.
 *   - `SyncOperation` — no delete in the cascade and no TTL on the schema, so the per-user
 *     idempotency ledger persisted indefinitely.
 *
 * Fix: both are deleted by the cascade now, and `SyncOperationSchema` carries a TTL index so
 * the ledger self-expires. The privacy policy's data-layer-scoping sentence is also brought in
 * line with the actual defense (a database-layer guard on top of per-endpoint checks) rather
 * than claiming universal coverage.
 */

const PRIVACY_POLICY_PATH = path.join(
    __dirname,
    '..',
    '..',
    'frontend',
    'corvale',
    'src',
    'legal',
    'privacy.md'
)

const DELETE_PASSWORD = 'DeleteMeNow123!'

async function deleteAccount(token: string) {
    return request(app)
        .delete('/api/v1/auth/account')
        .set(authHeader(token))
        .send({ password: DELETE_PASSWORD })
}

describe('Account deletion completeness (S25 / SEC-33)', () => {
    it('removes the SyncOperation ledger rows for the deleted user', async () => {
        const { userId, token } = await registerUser(app, {
            email: 'del-sync@example.com',
            password: DELETE_PASSWORD,
        })

        await SyncOperation.create({
            userId,
            opId: 'op-1',
            entity: 'transaction',
            operation: 'create',
            status: 'applied',
        })
        await SyncOperation.create({
            userId,
            opId: 'op-2',
            entity: 'account',
            operation: 'update',
            status: 'noop',
        })
        expect(await SyncOperation.countDocuments({ userId })).toBe(2)

        expect((await deleteAccount(token)).status).toBe(200)

        expect(await SyncOperation.countDocuments({ userId })).toBe(0)
    })

    it('removes pending workspace invites the user sent and received', async () => {
        const { userId, token } = await registerUser(app, {
            email: 'del-invites@example.com',
            password: DELETE_PASSWORD,
        })
        const other = new Types.ObjectId()

        await WorkspaceInvite.create({
            workspaceId: new Types.ObjectId(),
            inviterUserId: userId,
            inviteeUserId: other,
            role: 'editor',
            status: 'pending',
        })
        await WorkspaceInvite.create({
            workspaceId: new Types.ObjectId(),
            inviterUserId: other,
            inviteeUserId: userId,
            role: 'viewer',
            status: 'pending',
        })

        expect((await deleteAccount(token)).status).toBe(200)

        const left = await WorkspaceInvite.find({
            $or: [{ inviterUserId: userId }, { inviteeUserId: userId }],
        })
        expect(left).toHaveLength(0)
        expect(await User.findById(userId)).toBeNull()
    })

    it('leaves invites between other users untouched', async () => {
        const { token } = await registerUser(app, {
            email: 'del-invites-scoped@example.com',
            password: DELETE_PASSWORD,
        })
        const a = new Types.ObjectId()
        const b = new Types.ObjectId()

        const unrelated = await WorkspaceInvite.create({
            workspaceId: new Types.ObjectId(),
            inviterUserId: a,
            inviteeUserId: b,
            role: 'editor',
            status: 'pending',
        })

        expect((await deleteAccount(token)).status).toBe(200)

        expect(await WorkspaceInvite.findById(unrelated._id)).not.toBeNull()
    })
})

describe('SyncOperation retention (S25 / SEC-33)', () => {
    it('declares a TTL index on the idempotency ledger', () => {
        const ttlIndex = SyncOperation.schema
            .indexes()
            .find(([, options]) => typeof options?.expireAfterSeconds === 'number')

        expect(ttlIndex).toBeDefined()
        expect(ttlIndex![1].expireAfterSeconds).toBeGreaterThan(0)
    })
})

describe('Privacy-policy claims match the implementation (S25 / SEC-33)', () => {
    const policy = fs.readFileSync(PRIVACY_POLICY_PATH, 'utf8')

    it('no longer claims every database query is scoped at the data layer', () => {
        expect(policy).not.toContain(
            'Every database query is scoped to your user account at the data layer'
        )
    })

    it('still describes a database-layer scoping guard (softened, not removed)', () => {
        expect(policy.toLowerCase()).toContain('database layer')
    })
})
