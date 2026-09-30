import type { Types } from 'mongoose'

import { RLS_BYPASS } from '@core/access/rowLevelSecurity'
import { User } from '@modules/users'
import { WorkspaceInvite } from '@modules/workspaces'

import Subscription from './subscription.model'
import SyncDevice from './syncDevice.model'
import UsageCounter from './usageCounter.model'
import { recomputeWorkspaceSeats } from './usage.service'

export const ORPHAN_ROW_GRACE_DAYS = 1

const DAY_MS = 24 * 60 * 60 * 1000
const CHUNK = 500
const BYPASS = { [RLS_BYPASS]: true }

export interface OrphanCleanupResult {
    subscriptions: number
    invites: number
}

const findMissingUserIds = async (ids: Types.ObjectId[]): Promise<Set<string>> => {
    const wanted = [...new Set(ids.map((id) => id.toString()))]
    const present = await User.find({ _id: { $in: wanted } }).select('_id').lean()
    const alive = new Set(present.map((user) => user._id.toString()))
    return new Set(wanted.filter((id) => !alive.has(id)))
}

async function forEachChunk<T>(cursor: AsyncIterable<T>, handle: (chunk: T[]) => Promise<void>): Promise<void> {
    let chunk: T[] = []
    for await (const row of cursor) {
        chunk.push(row)
        if (chunk.length >= CHUNK) {
            await handle(chunk)
            chunk = []
        }
    }
    if (chunk.length > 0) await handle(chunk)
}

/**
 * The unverified-account TTL index removes only the `User` document, so the trial `Subscription` made at
 * signup outlives it. A row with no provider link and no user is dead weight that still counts in the
 * metrics stock and shows in the admin list. Provider-linked rows are left for a human: they may hold
 * money the provider still knows about.
 */
const sweepOrphanedSubscriptions = async (cutoff: Date): Promise<number> => {
    const rows = Subscription.find({ createdAt: { $lt: cutoff }, providerCustomerId: null, providerSubscriptionId: null })
        .setOptions(BYPASS)
        .select('userId')
        .lean<{ _id: Types.ObjectId; userId: Types.ObjectId }[]>()
        .cursor()

    let removed = 0
    await forEachChunk(rows, async (chunk) => {
        const missing = await findMissingUserIds(chunk.map((row) => row.userId))
        const orphans = chunk.filter((row) => missing.has(row.userId.toString()))
        if (orphans.length === 0) return

        const userIds = orphans.map((row) => row.userId)
        const result = await Subscription.deleteMany({
            _id: { $in: orphans.map((row) => row._id) },
            providerCustomerId: null,
            providerSubscriptionId: null,
        }).setOptions(BYPASS)
        removed += result.deletedCount

        await UsageCounter.deleteMany({ userId: { $in: userIds } }).setOptions(BYPASS)
        await SyncDevice.deleteMany({ userId: { $in: userIds } }).setOptions(BYPASS)
    })
    return removed
}

/** An invite naming an account that no longer exists can never be answered, but it still holds a workspace seat. */
const sweepOrphanedInvites = async (cutoff: Date): Promise<number> => {
    const rows = WorkspaceInvite.find({ createdAt: { $lt: cutoff } })
        .select('workspaceId inviteeUserId inviterUserId')
        .lean<{ _id: Types.ObjectId; workspaceId: Types.ObjectId; inviteeUserId: Types.ObjectId; inviterUserId: Types.ObjectId }[]>()
        .cursor()

    let removed = 0
    await forEachChunk(rows, async (chunk) => {
        const missing = await findMissingUserIds(chunk.flatMap((row) => [row.inviteeUserId, row.inviterUserId]))
        const orphans = chunk.filter((row) => missing.has(row.inviteeUserId.toString()) || missing.has(row.inviterUserId.toString()))
        if (orphans.length === 0) return

        const result = await WorkspaceInvite.deleteMany({ _id: { $in: orphans.map((row) => row._id) } })
        removed += result.deletedCount

        const workspaceIds = new Set(orphans.map((row) => row.workspaceId.toString()))
        for (const workspaceId of workspaceIds) await recomputeWorkspaceSeats(workspaceId)
    })
    return removed
}

export const sweepOrphanedAccountRows = async (now: Date = new Date()): Promise<OrphanCleanupResult> => {
    const cutoff = new Date(now.getTime() - ORPHAN_ROW_GRACE_DAYS * DAY_MS)
    return {
        subscriptions: await sweepOrphanedSubscriptions(cutoff),
        invites: await sweepOrphanedInvites(cutoff),
    }
}
