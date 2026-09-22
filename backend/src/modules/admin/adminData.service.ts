import { Types } from 'mongoose'

import { RLS_BYPASS } from '@core/access/rowLevelSecurity'
import type { BillingInterval, GrandfatherKind, PlanCode, SubscriptionStatus } from '@core/billing/constants'
import type { PlanPrices } from '@core/billing/metrics'
import {
    BillingEvent,
    DeferredRevenueEntry,
    JobRun,
    MetricDaily,
    Plan,
    ProviderPayout,
    Subscription,
    SyncDevice,
    UsageCounter,
    type IBillingEvent,
    type IDeferredRevenueEntry,
    type IJobRun,
    type IMetricDaily,
    type IProviderPayout,
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

/**
 * Resolves the truncated 8-char ref the detail view shows (`toDeviceView`) back to a full device without
 * ever putting the full id on the wire: the admin never needs it, only the row it targets. `'ambiguous'`
 * is returned rather than picking one, for the practically-impossible case of two of this user's devices
 * sharing an 8-hex-char prefix.
 */
export const findDeviceByRef = async (userId: string, ref: string): Promise<ISyncDevice | 'ambiguous' | null> => {
    const matches = await SyncDevice.find({ userId: asObjectId(userId), deviceId: { $regex: `^${ref}` } })
        .setOptions(BYPASS)
        .lean<ISyncDevice[]>()
    if (matches.length === 0) return null
    return matches.length > 1 ? 'ambiguous' : matches[0]
}

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

/** `MetricDaily` carries no `userId` (anonymous by design, M7b) so needs no RLS bypass - read through here anyway, for one place that touches every billing-module collection. */
export const findMetricDailyRange = (fromDate: string, toDate: string): Promise<IMetricDaily[]> =>
    MetricDaily.find({ date: { $gte: fromDate, $lte: toDate } }).sort({ date: 1 }).lean<IMetricDaily[]>()

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

/** M7.5 resync: writes only the fields the admin was shown as differing, straight from a freshly re-fetched provider snapshot. */
export const applyProviderFields = (userId: string, patch: Record<string, unknown>): Promise<SubscriptionRow | null> =>
    previousRow({ userId: asObjectId(userId) }, { $set: patch })

export interface SubscriptionOutcomeRow {
    _id: Types.ObjectId
    planCode: PlanCode
    status: SubscriptionStatus
    interval: BillingInterval | null
    grandfatherKind: GrandfatherKind | null
}

/** M7b.3 grandfather cohort report: current state of a known set of subscriptions, nothing more. */
export const findSubscriptionsByIds = (ids: Types.ObjectId[]): Promise<SubscriptionOutcomeRow[]> =>
    ids.length === 0
        ? Promise.resolve([])
        : Subscription.find({ _id: { $in: ids } })
              .setOptions(BYPASS)
              .select('_id planCode status interval grandfatherKind')
              .lean<SubscriptionOutcomeRow[]>()

/** M7b.3: the same plan-price lookup `snapshotMetricsStock` uses, for the cohort report's "value foregone" figure. */
export const findPlanPrices = async (): Promise<Record<string, PlanPrices>> => {
    const plans = await Plan.find().select('code prices').lean<{ code: PlanCode; prices: PlanPrices }[]>()
    return Object.fromEntries(plans.map((plan) => [plan.code, plan.prices]))
}

/** `DeferredRevenueEntry` carries no `userId` (system bookkeeping, M8e) so needs no RLS bypass - read through here anyway, same footing as `findMetricDailyRange`. */
const recognitionMonthMatch = (fromMonth?: string, toMonth?: string): Record<string, unknown> => {
    if (!fromMonth && !toMonth) return {}
    const range: Record<string, string> = {}
    if (fromMonth) range.$gte = fromMonth
    if (toMonth) range.$lte = toMonth
    return { recognitionMonth: range }
}

export interface RevenueRecognitionSummaryRow {
    recognitionMonth: string
    currency: string
    recognizedAmountMinor: number
    entryCount: number
}

export const findRevenueRecognitionSummary = (fromMonth?: string, toMonth?: string): Promise<RevenueRecognitionSummaryRow[]> =>
    DeferredRevenueEntry.aggregate([
        { $match: recognitionMonthMatch(fromMonth, toMonth) },
        {
            $group: {
                _id: { recognitionMonth: '$recognitionMonth', currency: '$currency' },
                recognizedAmountMinor: { $sum: '$recognizedAmountMinor' },
                entryCount: { $sum: 1 },
            },
        },
        { $sort: { '_id.recognitionMonth': 1, '_id.currency': 1 } },
        {
            $project: {
                _id: 0,
                recognitionMonth: '$_id.recognitionMonth',
                currency: '$_id.currency',
                recognizedAmountMinor: 1,
                entryCount: 1,
            },
        },
    ])

/**
 * The CA-ready CSV export streams straight off this cursor. `sourceEventId` and
 * `providerSubscriptionId` are deliberately left out of the projection - they correlate a row back
 * to one Merchant-of-Record customer, so they stay internal to the ledger and never reach this
 * report's output (the "no PII" requirement, M8e).
 */
export const findRevenueRecognitionEntries = (fromMonth?: string, toMonth?: string) =>
    DeferredRevenueEntry.find(recognitionMonthMatch(fromMonth, toMonth))
        .select('recognitionMonth planCode bucketIndex recognizedAmountMinor currency paymentOccurredAt')
        .sort({ recognitionMonth: 1, bucketIndex: 1, _id: 1 })
        .lean<IDeferredRevenueEntry[]>()
        .cursor()

/** M8f: MoR-reported payouts. Also no `userId` - one row per period+currency, not per customer - so reads through here need no RLS bypass either. */
const payoutPeriodMatch = (fromMonth?: string, toMonth?: string): Record<string, unknown> => {
    if (!fromMonth && !toMonth) return {}
    const range: Record<string, string> = {}
    if (fromMonth) range.$gte = fromMonth
    if (toMonth) range.$lte = toMonth
    return { periodMonth: range }
}

export const findProviderPayouts = (fromMonth?: string, toMonth?: string): Promise<IProviderPayout[]> =>
    ProviderPayout.find(payoutPeriodMatch(fromMonth, toMonth))
        .sort({ periodMonth: 1, currency: 1 })
        .lean<IProviderPayout[]>()

export interface CreateProviderPayoutInput {
    periodMonth: string
    currency: string
    reportedPayoutMinor: number
    note: string | null
    recordedByAdminId: Types.ObjectId | null
}

/** Duplicate-key (one payout per period+currency) is left for the caller to translate - this file stays free of `CustomError`. */
export const createProviderPayout = (input: CreateProviderPayoutInput): Promise<IProviderPayout> => ProviderPayout.create(input)

export interface UpdateProviderPayoutInput {
    reportedPayoutMinor?: number
    note?: string | null
    firc?: string | null
    bankDepositRef?: string | null
    bankDepositDate?: Date | null
    bankDepositAmountMinor?: number | null
}

/** Caller validates `id` is a well-formed ObjectId first - an invalid one throws here rather than resolving to null. */
export const updateProviderPayoutFields = (id: string, updates: UpdateProviderPayoutInput): Promise<IProviderPayout | null> =>
    ProviderPayout.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: true }).lean<IProviderPayout | null>()
