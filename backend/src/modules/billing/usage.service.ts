import { Types } from 'mongoose'

import { RLS_BYPASS } from '@core/access/rowLevelSecurity'
import { RESOURCE_LIMIT_KEY, type UsageResource } from '@core/billing/constants'
import { isDuplicateKeyError } from '@core/db/objectId'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { Receipt } from '@modules/receipts'
import { Workspace, WorkspaceInvite } from '@modules/workspaces'

import { getUserEntitlements, isBillingEnabled } from './entitlement.service'
import SyncDevice from './syncDevice.model'
import UsageCounter from './usageCounter.model'

const BYPASS = { [RLS_BYPASS]: true }

/**
 * Per-user counters. `workspaceMembers` is not one of them: it is a per-workspace figure, kept on
 * the workspace itself (`seatCount`).
 */
export type CountedResource = Exclude<UsageResource, 'workspaceMembers'>
export const COUNTED_RESOURCES: readonly CountedResource[] = ['receiptBytes', 'syncDevices']

export const quotaExceededError = (resource: UsageResource): CustomError =>
    new CustomError(
        resource === 'syncDevices' ? ERROR_MESSAGES.BILLING.SYNC_DEVICE_LIMIT : ERROR_MESSAGES.BILLING.QUOTA_EXCEEDED,
        402
    )

/**
 * Usage is a fact about the user's data, not about their plan: every mutation maintains it, in every
 * billing state and whether or not billing is on. Billing only decides whether an operation is
 * allowed (`limit`); the counters are an authoritative cache that the rows can always rebuild.
 */

export const computeUsage = async (userId: string, resource: CountedResource): Promise<number> => {
    switch (resource) {
        case 'receiptBytes': {
            const [result] = await Receipt.aggregate([
                { $match: { userId: new Types.ObjectId(userId) } },
                { $group: { _id: null, total: { $sum: '$size' } } },
            ])
            return result?.total ?? 0
        }
        case 'syncDevices':
            return SyncDevice.countDocuments({ userId })
    }
}

const ensureCounter = async (userId: string, resource: CountedResource): Promise<void> => {
    if (await UsageCounter.exists({ userId, resource })) return

    const value = await computeUsage(userId, resource)
    try {
        await UsageCounter.updateOne({ userId, resource }, { $setOnInsert: { value } }, { upsert: true })
    } catch (error) {
        if (!isDuplicateKeyError(error)) throw error
    }
}

/**
 * One conditional increment: a reservation that would pass `limit` matches nothing and is refused,
 * so parallel requests cannot both fit. `limit: null` is unlimited. A missing counter starts from
 * the rows. Anything that is not a finite, non-negative amount is refused, never waved through.
 */
export const reserveUsage = async (params: {
    userId: string
    resource: CountedResource
    amount: number
    limit: number | null
}): Promise<void> => {
    const { userId, resource, amount, limit } = params
    if (!Number.isFinite(amount) || amount < 0) throw quotaExceededError(resource)
    if (amount === 0) return

    await ensureCounter(userId, resource)

    const reserved = await UsageCounter.findOneAndUpdate(
        limit === null ? { userId, resource } : { userId, resource, value: { $lte: limit - amount } },
        { $inc: { value: amount } }
    )
    if (!reserved) throw quotaExceededError(resource)
}

export const releaseUsage = async (userId: string, resource: CountedResource, amount: number): Promise<void> => {
    if (!Number.isFinite(amount) || amount <= 0) return

    await UsageCounter.updateOne(
        { userId, resource },
        [{ $set: { value: { $max: [0, { $subtract: ['$value', amount] }] } } }],
        { timestamps: false }
    )
}

export const recomputeUsageCounters = async (userId: string): Promise<void> => {
    for (const resource of COUNTED_RESOURCES) {
        const value = await computeUsage(userId, resource)
        await UsageCounter.updateOne({ userId, resource }, { $set: { value } }, { upsert: true })
    }
}

/** Reserve against the subject's plan limit for `resource`; while billing is off nothing is refused but usage is still counted. */
export const reserveQuota = async (userId: string, resource: CountedResource, amount: number): Promise<void> => {
    const limit = isBillingEnabled() ? (await getUserEntitlements(userId)).limits[RESOURCE_LIMIT_KEY[resource]] : null
    await reserveUsage({ userId, resource, amount, limit })
}

export const releaseQuota = async (userId: string, resource: CountedResource, amount: number): Promise<void> => {
    await releaseUsage(userId, resource, amount)
}

/** Seats in one workspace: every member (the owner included) and every pending invite. */
export const computeWorkspaceSeats = async (workspaceId: string): Promise<number> => {
    const workspace = await Workspace.findById(workspaceId).select('members').lean()
    if (!workspace) return 0

    const pendingInvites = await WorkspaceInvite.countDocuments({ workspaceId: workspace._id, status: 'pending' })
    return workspace.members.length + pendingInvites
}

const ensureSeatCount = async (workspaceId: string): Promise<void> => {
    if (await Workspace.exists({ _id: workspaceId, seatCount: { $ne: null } })) return

    // Conditional on still being uncounted, so a concurrent first reservation cannot be overwritten.
    await Workspace.updateOne(
        { _id: workspaceId, seatCount: null },
        { $set: { seatCount: await computeWorkspaceSeats(workspaceId) } },
        { timestamps: false }
    )
}

/** Takes one seat in this workspace, or refuses when `limit` seats are already in use. */
export const reserveWorkspaceSeat = async (workspaceId: string, limit: number | null): Promise<void> => {
    await ensureSeatCount(workspaceId)

    const reserved = await Workspace.findOneAndUpdate(
        limit === null ? { _id: workspaceId } : { _id: workspaceId, seatCount: { $lte: limit - 1 } },
        { $inc: { seatCount: 1 } },
        { timestamps: false }
    )
    if (!reserved) throw quotaExceededError('workspaceMembers')
}

export const releaseWorkspaceSeat = async (workspaceId: string): Promise<void> => {
    await Workspace.updateOne(
        { _id: workspaceId, seatCount: { $ne: null } },
        [{ $set: { seatCount: { $max: [0, { $subtract: ['$seatCount', 1] }] } } }],
        { timestamps: false }
    )
}

/** Seats are limited by the owner's plan; while billing is off nothing is refused but seats are still counted. */
export const reserveWorkspaceSeatQuota = async (workspaceId: string, ownerId: string): Promise<void> => {
    const limit = isBillingEnabled() ? (await getUserEntitlements(ownerId)).limits.workspaceMembers : null
    await reserveWorkspaceSeat(workspaceId, limit)
}

export const recomputeWorkspaceSeats = async (workspaceId: string): Promise<void> => {
    await Workspace.updateOne({ _id: workspaceId }, { $set: { seatCount: await computeWorkspaceSeats(workspaceId) } }, { timestamps: false })
}

/** Administrative repair: rebuild every counter from the rows. Not needed during normal billing transitions. */
export const recomputeAllUsageCounters = async (): Promise<{ users: number; workspaces: number }> => {
    const idLists = await Promise.all([
        Receipt.distinct('userId').setOptions(BYPASS),
        SyncDevice.distinct('userId').setOptions(BYPASS),
        UsageCounter.distinct('userId').setOptions(BYPASS),
    ])
    const userIds = new Set(idLists.flat().map((id) => String(id)))
    for (const userId of userIds) await recomputeUsageCounters(userId)

    const workspaces = await Workspace.find({}).select('_id').lean()
    for (const workspace of workspaces) await recomputeWorkspaceSeats(workspace._id.toString())

    return { users: userIds.size, workspaces: workspaces.length }
}
