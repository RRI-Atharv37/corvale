import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { Receipt } from '@modules/receipts'
import { Workspace, WorkspaceInvite } from '@modules/workspaces'
import {
    Plan,
    SyncDevice,
    UsageCounter,
    computeUsage,
    computeWorkspaceSeats,
    recomputeUsageCounters,
    recomputeWorkspaceSeats,
    releaseQuota,
    releaseUsage,
    releaseWorkspaceSeat,
    reserveQuota,
    reserveUsage,
    reserveWorkspaceSeat,
} from '@modules/billing'
import { disableBilling, enableBilling, seedTestPlans, setSubscription } from '@tests/billingHelpers'

/**
 * M4 - the atomic reserve/release behind every countable limit. `requireQuota` (M2b) only looks; a
 * request that must not race past a limit reserves through here. The counter is a cache the rows can
 * always rebuild: a missing counter is initialised from the rows, `recomputeUsageCounters` heals a
 * drifted one, and a reservation is one conditional increment so parallel requests cannot both fit.
 */

const userId = () => new Types.ObjectId().toString()

const counter = async (id: string, resource: 'receiptBytes' | 'syncDevices') =>
    (await UsageCounter.findOne({ userId: id, resource }).lean())?.value

const seedReceipt = (id: string, size: number, extra: Record<string, unknown> = {}) =>
    Receipt.create({
        userId: id,
        originalFilename: 'r.pdf',
        storedFilename: `${new Types.ObjectId().toString()}.pdf`,
        mimeType: 'application/pdf',
        size,
        ...extra,
    })

const seedWorkspace = (ownerId: string, memberIds: string[] = []) =>
    Workspace.create({
        name: 'Shared',
        ownerId,
        members: [{ userId: ownerId, role: 'owner' }, ...memberIds.map((m) => ({ userId: m, role: 'editor' as const }))],
    })

afterEach(() => disableBilling())

describe('reserveUsage', () => {
    it('fills a limit exactly and refuses the next unit with QUOTA_EXCEEDED, leaving the counter alone', async () => {
        const id = userId()

        await reserveUsage({ userId: id, resource: 'receiptBytes', amount: 60, limit: 100 })
        await reserveUsage({ userId: id, resource: 'receiptBytes', amount: 40, limit: 100 })

        await expect(reserveUsage({ userId: id, resource: 'receiptBytes', amount: 1, limit: 100 })).rejects.toMatchObject({
            statusCode: 402,
            message: ERROR_MESSAGES.BILLING.QUOTA_EXCEEDED,
        })
        expect(await counter(id, 'receiptBytes')).toBe(100)
    })

    it('reports the device message for the device resource', async () => {
        const id = userId()
        await reserveUsage({ userId: id, resource: 'syncDevices', amount: 1, limit: 1 })

        await expect(reserveUsage({ userId: id, resource: 'syncDevices', amount: 1, limit: 1 })).rejects.toMatchObject({
            statusCode: 402,
            message: ERROR_MESSAGES.BILLING.SYNC_DEVICE_LIMIT,
        })
    })

    it('a null limit is unlimited but still counts', async () => {
        const id = userId()

        await reserveUsage({ userId: id, resource: 'receiptBytes', amount: 1_000_000, limit: null })
        await reserveUsage({ userId: id, resource: 'receiptBytes', amount: 1_000_000, limit: null })

        expect(await counter(id, 'receiptBytes')).toBe(2_000_000)
    })

    it('a single request larger than the whole limit is refused outright', async () => {
        const id = userId()

        await expect(reserveUsage({ userId: id, resource: 'receiptBytes', amount: 101, limit: 100 })).rejects.toMatchObject({
            statusCode: 402,
        })
        expect(await counter(id, 'receiptBytes')).toBe(0)
    })

    it('parallel reservations can never pass the limit', async () => {
        const id = userId()

        const results = await Promise.allSettled(
            Array.from({ length: 12 }, () => reserveUsage({ userId: id, resource: 'syncDevices', amount: 1, limit: 3 }))
        )

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3)
        expect(results.filter((r) => r.status === 'rejected')).toHaveLength(9)
        expect(await counter(id, 'syncDevices')).toBe(3)
    })

    it('is refused while usage already exceeds the limit (a downgrade), with nothing freed', async () => {
        const id = userId()
        await UsageCounter.create({ userId: id, resource: 'receiptBytes', value: 300 })

        await expect(reserveUsage({ userId: id, resource: 'receiptBytes', amount: 1, limit: 100 })).rejects.toMatchObject({
            statusCode: 402,
        })
        expect(await counter(id, 'receiptBytes')).toBe(300)
    })

    it('a zero reservation is a no-op that never refuses', async () => {
        const id = userId()
        await UsageCounter.create({ userId: id, resource: 'receiptBytes', value: 300 })

        await reserveUsage({ userId: id, resource: 'receiptBytes', amount: 0, limit: 100 })

        expect(await counter(id, 'receiptBytes')).toBe(300)
    })

    it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('fails closed on an amount of %s', async (amount) => {
        await expect(reserveUsage({ userId: userId(), resource: 'receiptBytes', amount, limit: null })).rejects.toMatchObject({
            statusCode: 402,
        })
    })

    it('starts a missing counter from the rows, so usage from before the counter existed is counted', async () => {
        const id = userId()
        await seedReceipt(id, 70)

        await expect(reserveUsage({ userId: id, resource: 'receiptBytes', amount: 40, limit: 100 })).rejects.toMatchObject({
            statusCode: 402,
        })
        await reserveUsage({ userId: id, resource: 'receiptBytes', amount: 30, limit: 100 })

        expect(await counter(id, 'receiptBytes')).toBe(100)
    })

    it('initialising the counter concurrently does not double count', async () => {
        const id = userId()
        await seedReceipt(id, 10)

        await Promise.all(Array.from({ length: 5 }, () => reserveUsage({ userId: id, resource: 'receiptBytes', amount: 1, limit: null })))

        expect(await counter(id, 'receiptBytes')).toBe(15)
    })
})

describe('releaseUsage', () => {
    it('gives the units back', async () => {
        const id = userId()
        await reserveUsage({ userId: id, resource: 'receiptBytes', amount: 80, limit: 100 })

        await releaseUsage(id, 'receiptBytes', 30)

        expect(await counter(id, 'receiptBytes')).toBe(50)
    })

    it('never goes below zero', async () => {
        const id = userId()
        await reserveUsage({ userId: id, resource: 'receiptBytes', amount: 10, limit: 100 })

        await releaseUsage(id, 'receiptBytes', 500)

        expect(await counter(id, 'receiptBytes')).toBe(0)
    })

    it('does nothing when the counter was never started', async () => {
        const id = userId()

        await releaseUsage(id, 'receiptBytes', 10)

        expect(await counter(id, 'receiptBytes')).toBeUndefined()
    })

    it('frees room for a reservation that was refused', async () => {
        const id = userId()
        await reserveUsage({ userId: id, resource: 'receiptBytes', amount: 100, limit: 100 })
        await expect(reserveUsage({ userId: id, resource: 'receiptBytes', amount: 10, limit: 100 })).rejects.toBeDefined()

        await releaseUsage(id, 'receiptBytes', 10)

        await reserveUsage({ userId: id, resource: 'receiptBytes', amount: 10, limit: 100 })
        expect(await counter(id, 'receiptBytes')).toBe(100)
    })
})

describe('computeUsage - what the rows say', () => {
    it('receiptBytes sums the live receipts and ignores deleted ones', async () => {
        const id = userId()
        await seedReceipt(id, 10)
        await seedReceipt(id, 25)
        await seedReceipt(id, 500, { deletedAt: new Date() })
        await seedReceipt(userId(), 999)

        expect(await computeUsage(id, 'receiptBytes')).toBe(35)
    })

    it('syncDevices counts the registered devices', async () => {
        const id = userId()
        const now = new Date()
        await SyncDevice.create([
            { userId: id, deviceId: 'a', firstSeenAt: now, lastSeenAt: now },
            { userId: id, deviceId: 'b', firstSeenAt: now, lastSeenAt: now },
        ])

        expect(await computeUsage(id, 'syncDevices')).toBe(2)
    })

    it('is zero for a user with nothing', async () => {
        for (const resource of ['receiptBytes', 'syncDevices'] as const) {
            expect(await computeUsage(userId(), resource)).toBe(0)
        }
    })
})

describe('recomputeUsageCounters', () => {
    it('rebuilds a drifted counter from the rows', async () => {
        const id = userId()
        await seedReceipt(id, 40)
        await UsageCounter.create({ userId: id, resource: 'receiptBytes', value: 9999 })

        await recomputeUsageCounters(id)

        expect(await counter(id, 'receiptBytes')).toBe(40)
    })

    it('creates the counters that do not exist yet, at zero when there is nothing', async () => {
        const id = userId()

        await recomputeUsageCounters(id)

        expect(await counter(id, 'receiptBytes')).toBe(0)
        expect(await counter(id, 'syncDevices')).toBe(0)
    })

    it('touches only the named user', async () => {
        const id = userId()
        const other = userId()
        await UsageCounter.create({ userId: other, resource: 'receiptBytes', value: 7 })

        await recomputeUsageCounters(id)

        expect(await counter(other, 'receiptBytes')).toBe(7)
    })
})

describe('reserveQuota / releaseQuota - against the plan', () => {
    let id: string

    beforeEach(async () => {
        enableBilling()
        await seedTestPlans({ plus: { limits: { receiptStorageBytes: 100 } } })
        id = userId()
        await setSubscription(id, { planCode: 'plus' })
    })

    it("reserves against the subject's plan limit", async () => {
        await reserveQuota(id, 'receiptBytes', 100)

        await expect(reserveQuota(id, 'receiptBytes', 1)).rejects.toMatchObject({
            statusCode: 402,
            message: ERROR_MESSAGES.BILLING.QUOTA_EXCEEDED,
        })
    })

    it('follows a plan change on the very next call', async () => {
        await reserveQuota(id, 'receiptBytes', 100)
        await expect(reserveQuota(id, 'receiptBytes', 1)).rejects.toBeDefined()

        await setSubscription(id, { planCode: 'pro' })

        await reserveQuota(id, 'receiptBytes', 1)
    })

    it('a user with no subscription has zero limits and is refused, never waved through', async () => {
        await expect(reserveQuota(userId(), 'receiptBytes', 1)).rejects.toMatchObject({ statusCode: 402 })
    })

    it('an unseeded catalogue falls back to the launch limits instead of unlimited', async () => {
        await Plan.deleteMany({})

        await expect(reserveQuota(id, 'receiptBytes', 2 * 1024 ** 3)).rejects.toMatchObject({ statusCode: 402 })
    })

    it('release gives the units back', async () => {
        await reserveQuota(id, 'receiptBytes', 100)

        await releaseQuota(id, 'receiptBytes', 60)

        await reserveQuota(id, 'receiptBytes', 60)
    })

    it('while billing is off nothing is ever refused, but the counter is still kept', async () => {
        disableBilling()

        await reserveQuota(id, 'receiptBytes', 10_000_000)
        await releaseQuota(id, 'receiptBytes', 10)

        expect(await counter(id, 'receiptBytes')).toBe(10_000_000 - 10)
    })

    it('what Corvale knows about the data does not depend on billing: switching billing on finds an accurate counter', async () => {
        disableBilling()
        await reserveQuota(id, 'receiptBytes', 60)
        enableBilling()

        await expect(reserveQuota(id, 'receiptBytes', 41)).rejects.toMatchObject({ statusCode: 402 })
        await reserveQuota(id, 'receiptBytes', 40)
    })
})

describe('computeWorkspaceSeats', () => {
    it('counts every member, the owner included, and every pending invite - only in this workspace', async () => {
        const owner = userId()
        const first = await seedWorkspace(owner, [userId()])
        const other = await seedWorkspace(owner, [userId(), userId()])
        await WorkspaceInvite.create({ workspaceId: first._id, inviterUserId: owner, inviteeUserId: userId(), role: 'viewer', status: 'pending' })
        await WorkspaceInvite.create({ workspaceId: first._id, inviterUserId: owner, inviteeUserId: userId(), role: 'viewer', status: 'declined' })
        await WorkspaceInvite.create({ workspaceId: other._id, inviterUserId: owner, inviteeUserId: userId(), role: 'viewer', status: 'accepted' })

        expect(await computeWorkspaceSeats(first._id.toString())).toBe(3)
        expect(await computeWorkspaceSeats(other._id.toString())).toBe(3)
    })

    it('is zero for a workspace that does not exist', async () => {
        expect(await computeWorkspaceSeats(new Types.ObjectId().toString())).toBe(0)
    })
})

describe('workspace seats - reserve and release, per workspace', () => {
    const seats = async (workspaceId: string) => (await Workspace.findById(workspaceId).lean())?.seatCount

    it('fills one workspace to its limit without touching another', async () => {
        const owner = userId()
        const a = (await seedWorkspace(owner)).id as string
        const b = (await seedWorkspace(owner)).id as string

        await reserveWorkspaceSeat(a, 2)
        await expect(reserveWorkspaceSeat(a, 2)).rejects.toMatchObject({ statusCode: 402, message: ERROR_MESSAGES.BILLING.QUOTA_EXCEEDED })
        await reserveWorkspaceSeat(b, 2)

        expect(await seats(a)).toBe(2)
        expect(await seats(b)).toBe(2)
    })

    it('starts a workspace that was never counted from its rows, pending invites included', async () => {
        const owner = userId()
        const workspace = await seedWorkspace(owner)
        await WorkspaceInvite.create({ workspaceId: workspace._id, inviterUserId: owner, inviteeUserId: userId(), role: 'viewer', status: 'pending' })

        await expect(reserveWorkspaceSeat(workspace.id, 2)).rejects.toMatchObject({ statusCode: 402 })
        expect(await seats(workspace.id)).toBe(2)
    })

    it('a null limit is unlimited but still counts', async () => {
        const workspace = await seedWorkspace(userId())

        await reserveWorkspaceSeat(workspace.id, null)
        await reserveWorkspaceSeat(workspace.id, null)

        expect(await seats(workspace.id)).toBe(3)
    })

    it('parallel invites can never pass the limit', async () => {
        const workspace = await seedWorkspace(userId())

        const results = await Promise.allSettled(Array.from({ length: 10 }, () => reserveWorkspaceSeat(workspace.id, 4)))

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3)
        expect(await seats(workspace.id)).toBe(4)
    })

    it('is refused for a workspace already over a lowered limit, and frees nothing', async () => {
        const workspace = await seedWorkspace(userId(), [userId(), userId(), userId()])

        await expect(reserveWorkspaceSeat(workspace.id, 2)).rejects.toMatchObject({ statusCode: 402 })
        expect(await seats(workspace.id)).toBe(4)
    })

    it('release gives the seat back, never below zero, and ignores a workspace that was never counted', async () => {
        const workspace = await seedWorkspace(userId())
        await reserveWorkspaceSeat(workspace.id, 5)

        await releaseWorkspaceSeat(workspace.id)
        await releaseWorkspaceSeat(workspace.id)
        await releaseWorkspaceSeat(workspace.id)
        expect(await seats(workspace.id)).toBe(0)

        const fresh = await seedWorkspace(userId())
        await releaseWorkspaceSeat(fresh.id)
        expect(await seats(fresh.id)).toBeNull()
    })

    it('recomputeWorkspaceSeats heals a drifted count', async () => {
        const workspace = await seedWorkspace(userId(), [userId()])
        await Workspace.updateOne({ _id: workspace._id }, { $set: { seatCount: 99 } })

        await recomputeWorkspaceSeats(workspace.id)

        expect(await seats(workspace.id)).toBe(2)
    })

    it('does not bump the workspace updatedAt', async () => {
        const workspace = await seedWorkspace(userId())
        const before = (await Workspace.findById(workspace._id).lean() as { updatedAt?: Date } | null)?.updatedAt

        await reserveWorkspaceSeat(workspace.id, null)

        expect((await Workspace.findById(workspace._id).lean() as { updatedAt?: Date } | null)?.updatedAt).toEqual(before)
    })
})
