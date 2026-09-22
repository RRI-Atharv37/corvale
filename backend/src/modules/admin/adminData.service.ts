import { Types } from 'mongoose'

import { RLS_BYPASS } from '@core/access/rowLevelSecurity'
import type { GrandfatherKind } from '@core/billing/constants'
import {
    BillingEvent,
    JobRun,
    Subscription,
    SyncDevice,
    UsageCounter,
    type IBillingEvent,
    type IJobRun,
    type ISubscription,
    type ISyncDevice,
    type IUsageCounter,
    type JobName,
} from '@modules/billing'
import { User } from '@modules/users'
import { Workspace } from '@modules/workspaces'

/**
 * The single place the admin module reaches past row-level security. Admin requests carry no user context,
 * so every read of a tenant collection is deliberately unscoped and goes through here, where the shape of
 * each query is visible in one file. `adminBoundary.test.ts` fails if RLS_BYPASS appears anywhere else.
 */
const BYPASS = { [RLS_BYPASS]: true }

export const asObjectId = (value: string | Types.ObjectId): Types.ObjectId => new Types.ObjectId(value)

export interface UserProjection {
    _id: Types.ObjectId
    email: string
    createdAt: Date
    isEmailVerified: boolean
    legalAcceptance?: { termsVersion: string; privacyVersion: string; acceptedAt: Date; ageAttested: boolean }
}

const USER_FIELDS = 'email createdAt isEmailVerified legalAcceptance'

export const findUserById = (userId: string): Promise<UserProjection | null> =>
    User.findById(userId).select(USER_FIELDS).lean<UserProjection>()

export const findUserByEmail = (email: string): Promise<UserProjection | null> =>
    User.findOne({ email }).select(USER_FIELDS).lean<UserProjection>()

export const findUserEmails = async (userIds: Types.ObjectId[]): Promise<Map<string, string>> => {
    const users = await User.find({ _id: { $in: userIds } }).select('email').lean<{ _id: Types.ObjectId; email: string }[]>()
    return new Map(users.map((user) => [user._id.toString(), user.email]))
}

export type SubscriptionRow = ISubscription

export const findSubscriptionByUserId = (userId: string): Promise<SubscriptionRow | null> =>
    Subscription.findOne({ userId: asObjectId(userId) }).setOptions(BYPASS).lean<SubscriptionRow>()

export const findSubscriptionByProviderId = (providerId: string): Promise<SubscriptionRow | null> =>
    Subscription.findOne({ $or: [{ providerCustomerId: providerId }, { providerSubscriptionId: providerId }] })
        .setOptions(BYPASS)
        .lean<SubscriptionRow>()

export const pageSubscriptions = async (
    filter: Record<string, unknown>,
    page: number,
    limit: number
): Promise<{ rows: SubscriptionRow[]; total: number }> => {
    const [rows, total] = await Promise.all([
        Subscription.find(filter)
            .setOptions(BYPASS)
            .sort({ createdAt: -1, _id: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean<SubscriptionRow[]>(),
        Subscription.countDocuments(filter).setOptions(BYPASS),
    ])
    return { rows, total }
}

export const findRows = (filter: Record<string, unknown>, limit: number): Promise<SubscriptionRow[]> =>
    Subscription.find(filter).setOptions(BYPASS).sort({ _id: 1 }).limit(limit).lean<SubscriptionRow[]>()

export const countRows = (filter: Record<string, unknown>): Promise<number> => Subscription.countDocuments(filter).setOptions(BYPASS)

export const findUsageCounters = (userId: string): Promise<IUsageCounter[]> =>
    UsageCounter.find({ userId: asObjectId(userId) }).setOptions(BYPASS).lean<IUsageCounter[]>()

export const findDevices = (userId: string): Promise<ISyncDevice[]> =>
    SyncDevice.find({ userId: asObjectId(userId) })
        .setOptions(BYPASS)
        .sort({ firstSeenAt: 1, _id: 1 })
        .lean<ISyncDevice[]>()

export interface OwnedWorkspace {
    _id: Types.ObjectId
    members: { userId: Types.ObjectId }[]
}

export const findOwnedWorkspaces = (userId: string): Promise<OwnedWorkspace[]> =>
    Workspace.find({ ownerId: asObjectId(userId) }).select('_id members').lean<OwnedWorkspace[]>()

export const findBillingEventsFor = (
    identifiers: { providerCustomerId: string | null; providerSubscriptionId: string | null },
    limit: number
): Promise<IBillingEvent[]> => {
    const clauses: Record<string, string>[] = []
    if (identifiers.providerSubscriptionId) clauses.push({ 'payload.providerSubscriptionId': identifiers.providerSubscriptionId })
    if (identifiers.providerCustomerId) clauses.push({ 'payload.providerCustomerId': identifiers.providerCustomerId })
    if (clauses.length === 0) return Promise.resolve([])

    return BillingEvent.find({ $or: clauses }).sort({ occurredAt: -1, _id: -1 }).limit(limit).lean<IBillingEvent[]>()
}

const UNAPPLIED_EVENTS = { processedAt: null, error: { $ne: null } }

export const countUnprocessedEvents = (): Promise<number> => BillingEvent.countDocuments(UNAPPLIED_EVENTS)

export const findRecentUnprocessedEvents = (limit: number): Promise<IBillingEvent[]> =>
    BillingEvent.find(UNAPPLIED_EVENTS).sort({ occurredAt: -1, _id: -1 }).limit(limit).lean<IBillingEvent[]>()

export const findLatestJobRun = (name: JobName): Promise<IJobRun | null> =>
    JobRun.findOne({ name }).sort({ startedAt: -1, _id: -1 }).lean<IJobRun>()

/**
 * Overlay writes. Each touches only the staff-owned fields (`adminGrant`, `retentionHoldUntil`) or, for a
 * trial extension, Corvale-owned trial state guarded to unlinked trials; none touches a provider-owned field.
 * They return the row as it was before, for the audit trail.
 */
const previousRow = (filter: Record<string, unknown>, update: Record<string, unknown>): Promise<SubscriptionRow | null> =>
    Subscription.findOneAndUpdate(filter, update, { new: false }).setOptions(BYPASS).lean<SubscriptionRow>()

export const replaceAdminGrant = (userId: string, grant: Record<string, unknown> | null): Promise<SubscriptionRow | null> =>
    previousRow({ userId: asObjectId(userId) }, { $set: { adminGrant: grant } })

export const replaceRetentionHold = (userId: string, until: Date | null): Promise<SubscriptionRow | null> =>
    previousRow({ userId: asObjectId(userId) }, { $set: { retentionHoldUntil: until } })

/** Refuses (returns null) unless the row is still an unlinked trial, so a concurrent webhook or upgrade wins. */
export const reopenTrial = (userId: string, currentStatus: string, trialEndsAt: Date): Promise<SubscriptionRow | null> =>
    previousRow(
        { userId: asObjectId(userId), status: currentStatus, providerSubscriptionId: null, providerCustomerId: null },
        { $set: { status: 'trialing', trialEndsAt, lapsedAt: null, retentionStage: null, retentionStageAt: null } }
    )

export const replaceGrandfatherKind = (userId: string, kind: GrandfatherKind | null): Promise<SubscriptionRow | null> =>
    previousRow({ userId: asObjectId(userId) }, { $set: { grandfatherKind: kind } })

/**
 * The M7.4 bulk cohort: users who registered before a cutoff, have no payment-provider link and are not
 * already grandfathered. Two plain queries rather than a `$lookup` - the admin module is forbidden from
 * cross-collection aggregation (adminBoundary.test.ts), and the User side of this is small in practice
 * (the pre-paywall cohort it targets).
 */
export const findUserIdsRegisteredBefore = async (cutoff: Date): Promise<Types.ObjectId[]> => {
    const rows = await User.find({ createdAt: { $lt: cutoff } }).select('_id').lean<{ _id: Types.ObjectId }[]>()
    return rows.map((row) => row._id)
}

const cohortFilter = (userIds: Types.ObjectId[]) => ({
    userId: { $in: userIds },
    grandfatherKind: null,
    providerCustomerId: null,
    providerSubscriptionId: null,
})

export interface CohortSubscriptionRow {
    _id: Types.ObjectId
    userId: Types.ObjectId
}

export const countCohortSubscriptions = (userIds: Types.ObjectId[]): Promise<number> =>
    userIds.length === 0 ? Promise.resolve(0) : Subscription.countDocuments(cohortFilter(userIds)).setOptions(BYPASS)

export const findCohortSubscriptions = (userIds: Types.ObjectId[], limit?: number): Promise<CohortSubscriptionRow[]> => {
    if (userIds.length === 0) return Promise.resolve([])
    const query = Subscription.find(cohortFilter(userIds)).setOptions(BYPASS).select('_id userId').sort({ _id: 1 })
    return (typeof limit === 'number' ? query.limit(limit) : query).lean<CohortSubscriptionRow[]>()
}

/** Only ever moves an eligible row (still ungrandfathered) into the cohort's kind - a row a concurrent action already touched is left alone. */
export const applyCohortGrandfather = async (subscriptionIds: Types.ObjectId[], kind: GrandfatherKind): Promise<number> => {
    const result = await Subscription.updateMany({ _id: { $in: subscriptionIds }, grandfatherKind: null }, { $set: { grandfatherKind: kind } }).setOptions(BYPASS)
    return result.modifiedCount
}

/** Only reverts a row still at the batch's kind - a row an admin has since changed by hand is left alone. */
export const revertCohortGrandfather = async (subscriptionIds: Types.ObjectId[], kind: GrandfatherKind): Promise<number> => {
    const result = await Subscription.updateMany({ _id: { $in: subscriptionIds }, grandfatherKind: kind }, { $set: { grandfatherKind: null } }).setOptions(BYPASS)
    return result.modifiedCount
}
