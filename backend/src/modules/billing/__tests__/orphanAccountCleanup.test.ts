import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RLS_BYPASS } from '@core/access/rowLevelSecurity'
import { Workspace, WorkspaceInvite } from '@modules/workspaces'
import {
    ORPHAN_ROW_GRACE_DAYS,
    Subscription,
    SyncDevice,
    UsageCounter,
    recomputeWorkspaceSeats,
    runBillingSweeps,
    sweepOrphanedAccountRows,
} from '@modules/billing'
import { seedUserDirectly } from '@tests/helpers'
import { DAY_MS, disableBilling, enableBilling, randomId, seedPendingInvite, seedWorkspace, setSubscription } from '@tests/billingHelpers'

/**
 * BUG-51 / BUG-52 - the unverified-account TTL removes only the `User`, so the trial `Subscription`,
 * its usage rows and any invite naming the account outlive it. The sweep reaps them once they have
 * been userless for longer than the grace window.
 */

const NOW = new Date('2026-11-01T12:00:00.000Z')
const OLD = new Date(NOW.getTime() - (ORPHAN_ROW_GRACE_DAYS + 1) * DAY_MS)
const RECENT = new Date(NOW.getTime() - 60 * 60 * 1000)

const ageSubscription = (userId: string, createdAt: Date) =>
    Subscription.updateOne({ userId }, { $set: { createdAt } }, { timestamps: false, overwriteImmutable: true, [RLS_BYPASS]: true })

const ageInvite = (inviteId: string, createdAt: Date) =>
    WorkspaceInvite.updateOne({ _id: inviteId }, { $set: { createdAt } }, { timestamps: false, overwriteImmutable: true })

const seedOrphanTrial = async (createdAt: Date = OLD) => {
    const userId = randomId()
    await setSubscription(userId, { status: 'trialing', providerCustomerId: null, providerSubscriptionId: null })
    await ageSubscription(userId, createdAt)
    return userId
}

beforeEach(() => enableBilling())
afterEach(() => disableBilling())

describe('sweepOrphanedAccountRows - subscriptions', () => {
    it('removes an old unlinked subscription whose user is gone, with its usage counters and devices', async () => {
        const orphan = await seedOrphanTrial()
        await UsageCounter.create({ userId: orphan, resource: 'receiptBytes', value: 5 })
        await SyncDevice.create({ userId: orphan, deviceId: 'device-orphan-0001', firstSeenAt: NOW, lastSeenAt: NOW })

        const result = await sweepOrphanedAccountRows(NOW)

        expect(result.subscriptions).toBe(1)
        expect(await Subscription.countDocuments({ userId: orphan }).setOptions({ [RLS_BYPASS]: true })).toBe(0)
        expect(await UsageCounter.countDocuments({ userId: orphan }).setOptions({ [RLS_BYPASS]: true })).toBe(0)
        expect(await SyncDevice.countDocuments({ userId: orphan }).setOptions({ [RLS_BYPASS]: true })).toBe(0)
    })

    it('keeps the subscription of a user that still exists', async () => {
        const user = await seedUserDirectly({ email: 'alive@example.com' })
        await setSubscription(user.userId, { status: 'trialing', providerCustomerId: null, providerSubscriptionId: null })
        await ageSubscription(user.userId, OLD)

        const result = await sweepOrphanedAccountRows(NOW)

        expect(result.subscriptions).toBe(0)
        expect(await Subscription.countDocuments({ userId: user.userId }).setOptions({ [RLS_BYPASS]: true })).toBe(1)
    })

    it('keeps a userless subscription that is provider-linked: that may be money the provider still holds', async () => {
        const userId = randomId()
        await setSubscription(userId, { status: 'active', providerCustomerId: 'cus_keep', providerSubscriptionId: 'sub_keep' })
        await ageSubscription(userId, OLD)

        const result = await sweepOrphanedAccountRows(NOW)

        expect(result.subscriptions).toBe(0)
        expect(await Subscription.countDocuments({ userId }).setOptions({ [RLS_BYPASS]: true })).toBe(1)
    })

    it('leaves a young userless subscription alone', async () => {
        const recent = await seedOrphanTrial(RECENT)

        const result = await sweepOrphanedAccountRows(NOW)

        expect(result.subscriptions).toBe(0)
        expect(await Subscription.countDocuments({ userId: recent }).setOptions({ [RLS_BYPASS]: true })).toBe(1)
    })

    it('is idempotent', async () => {
        await seedOrphanTrial()

        await sweepOrphanedAccountRows(NOW)
        const second = await sweepOrphanedAccountRows(NOW)

        expect(second).toEqual({ subscriptions: 0, invites: 0 })
    })
})

describe('sweepOrphanedAccountRows - invites', () => {
    it('removes a pending invite to a vanished user and gives the seat back', async () => {
        const owner = await seedUserDirectly({ email: 'owner-orphan@example.com' })
        const workspaceId = await seedWorkspace(owner.userId)
        const ghost = randomId()
        const inviteId = await seedPendingInvite(workspaceId, owner.userId, ghost)
        await ageInvite(inviteId, OLD)
        await recomputeWorkspaceSeats(workspaceId)
        expect((await Workspace.findById(workspaceId))?.seatCount).toBe(2)

        const result = await sweepOrphanedAccountRows(NOW)

        expect(result.invites).toBe(1)
        expect(await WorkspaceInvite.countDocuments({ _id: inviteId })).toBe(0)
        expect((await Workspace.findById(workspaceId))?.seatCount).toBe(1)
    })

    it('keeps a pending invite whose invitee and inviter both exist', async () => {
        const owner = await seedUserDirectly({ email: 'owner-live@example.com' })
        const invitee = await seedUserDirectly({ email: 'invitee-live@example.com' })
        const workspaceId = await seedWorkspace(owner.userId)
        const inviteId = await seedPendingInvite(workspaceId, owner.userId, invitee.userId)
        await ageInvite(inviteId, OLD)

        const result = await sweepOrphanedAccountRows(NOW)

        expect(result.invites).toBe(0)
        expect(await WorkspaceInvite.countDocuments({ _id: inviteId })).toBe(1)
    })

    it('leaves a young invite to a vanished user alone', async () => {
        const owner = await seedUserDirectly({ email: 'owner-young@example.com' })
        const workspaceId = await seedWorkspace(owner.userId)
        const inviteId = await seedPendingInvite(workspaceId, owner.userId, randomId())
        await ageInvite(inviteId, RECENT)

        expect((await sweepOrphanedAccountRows(NOW)).invites).toBe(0)
        expect(await WorkspaceInvite.countDocuments({ _id: inviteId })).toBe(1)
    })
})

describe('runBillingSweeps', () => {
    it('cleans orphans and reports the counts, with billing on', async () => {
        await seedOrphanTrial()

        const result = await runBillingSweeps(NOW)

        expect(result.orphans).toEqual({ subscriptions: 1, invites: 0 })
    })

    it('still cleans orphans while billing is off: data hygiene does not depend on billing state', async () => {
        await seedOrphanTrial()
        disableBilling()

        const result = await runBillingSweeps(NOW)

        expect(result.skipped).toBe(true)
        expect(result.orphans.subscriptions).toBe(1)
    })
})
