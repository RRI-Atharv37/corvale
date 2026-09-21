import { Types } from 'mongoose'

import { resolveEntitlements } from '@core/billing/entitlements'
import type { AdminGrantSnapshot } from '@core/billing/entitlements'
import { explainWriteAccess } from '@core/billing/readOnlyReason'
import { deriveLapsedAt, isRetentionPaused, retentionClockStart, retentionEndsAt, LAPSED_STATUSES } from '@core/billing/retention'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { getPastDueGraceDays, getRetentionDays, getUserEntitlementSnapshot, isRetentionEnabled } from '@modules/billing'

import AdminAuditLog from './adminAuditLog.model'
import { parsePagination, recordAudit } from './adminAudit.service'
import { getDetailViewsPerHour } from './adminConfig'
import {
    findBillingEventsFor,
    findDevices,
    findOwnedWorkspaces,
    findSubscriptionByProviderId,
    findSubscriptionByUserId,
    findUsageCounters,
    findUserByEmail,
    findUserById,
    findUserEmails,
    pageSubscriptions,
    type SubscriptionRow,
} from './adminData.service'
import { buildSubscriberFilter, singleString } from './adminSubscriberQuery'
import type { AdminPrincipal, AdminRequestContext } from './adminTypes'
import {
    toBillingEventView,
    toDeviceView,
    toHistoryEntryView,
    toSubscriberDetailAccount,
    toSubscriberDetailLegal,
    toSubscriberDetailSubscription,
    toSubscriberListItem,
    toWorkspaceView,
} from './adminViews'

const HOUR_MS = 60 * 60 * 1000
const OBJECT_ID = /^[0-9a-f]{24}$/i
const MAX_QUERY_LENGTH = 254
const DETAIL_EVENT_LIMIT = 25
const DETAIL_HISTORY_LIMIT = 20

const invalidQuery = (): CustomError => new CustomError(ERROR_MESSAGES.ADMIN.INVALID_QUERY, 400)

const listItemFor = (userId: string, email: string, subscription: SubscriptionRow | null, now: Date) => {
    const resolved = subscription ? resolveEntitlements(subscription, null, now, { pastDueGraceDays: getPastDueGraceDays() }) : null
    return toSubscriberListItem({
        userId,
        email,
        subscription,
        resolvedStatus: resolved?.status ?? 'none',
        canWrite: resolved?.canWrite ?? false,
        now,
    })
}

/**
 * Exact match only, and only on identifiers an operator already holds: an email, a user id, or a provider
 * customer/subscription id. A prefix, a domain or a pattern finds nothing, so the tool cannot be used to
 * enumerate customers.
 */
export const lookupSubscribers = async (rawQuery: unknown, now: Date = new Date()) => {
    const q = singleString(rawQuery)?.trim()
    if (!q || q.length > MAX_QUERY_LENGTH) throw invalidQuery()

    const byUser = new Map<string, { email: string; subscription: SubscriptionRow | null }>()

    const user = q.includes('@') ? await findUserByEmail(q.toLowerCase()) : OBJECT_ID.test(q) ? await findUserById(q) : null
    if (user) byUser.set(user._id.toString(), { email: user.email, subscription: await findSubscriptionByUserId(user._id.toString()) })

    if (!q.includes('@')) {
        const subscription = await findSubscriptionByProviderId(q)
        if (subscription && !byUser.has(subscription.userId.toString())) {
            const owner = await findUserById(subscription.userId.toString())
            byUser.set(subscription.userId.toString(), { email: owner?.email ?? '', subscription })
        }
    }

    return { subscribers: [...byUser.entries()].map(([userId, entry]) => listItemFor(userId, entry.email, entry.subscription, now)) }
}

export const listSubscribers = async (query: Record<string, unknown>, now: Date = new Date()) => {
    const { page, limit } = parsePagination(query)
    const filter = buildSubscriberFilter(query, now)

    const { rows, total } = await pageSubscriptions(filter, page, limit)
    const emails = await findUserEmails(rows.map((row) => row.userId))

    return {
        subscribers: rows.map((row) => listItemFor(row.userId.toString(), emails.get(row.userId.toString()) ?? '', row, now)),
        total,
        page,
        limit,
    }
}

const activeCompUntil = (grant: AdminGrantSnapshot | null | undefined, now: Date): Date | null =>
    grant && grant.kind === 'comp' && grant.until.getTime() > now.getTime() ? grant.until : null

/** When (if ever) the retention job would erase this account, honouring a free-forever grant, a comp and a hold. */
const describeErasure = (subscription: SubscriptionRow | null, now: Date) => {
    const retentionEnabled = isRetentionEnabled()
    const lapsed = subscription !== null && (LAPSED_STATUSES as readonly string[]).includes(subscription.status)
    const compUntil = activeCompUntil(subscription?.adminGrant, now)
    const held = subscription ? isRetentionPaused(subscription.retentionHoldUntil, compUntil, now) : false

    let projectedEraseAt: Date | null = null
    if (subscription && retentionEnabled && lapsed && subscription.grandfatherKind !== 'free_forever') {
        const lapsedAt = subscription.lapsedAt ?? deriveLapsedAt(subscription, now)
        projectedEraseAt = retentionEndsAt(retentionClockStart(lapsedAt, subscription.retentionHoldUntil, subscription.adminGrant?.kind === 'comp' ? subscription.adminGrant.until : null), getRetentionDays())
    }

    return {
        retentionEnabled,
        retentionDays: getRetentionDays(),
        lapsedAt: subscription?.lapsedAt ?? null,
        projectedEraseAt,
        lastNoticeStage: subscription?.retentionStage ?? null,
        lastNoticeAt: subscription?.retentionStageAt ?? null,
        held,
    }
}

const assertUnderDetailCap = async (adminId: string, now: Date): Promise<void> => {
    const recent = await AdminAuditLog.countDocuments({
        adminId: new Types.ObjectId(adminId),
        action: 'subscription.viewed',
        at: { $gte: new Date(now.getTime() - HOUR_MS) },
    })
    if (recent >= getDetailViewsPerHour()) throw new CustomError(ERROR_MESSAGES.ADMIN.DETAIL_VIEW_LIMIT, 429)
}

const flattenLimits = (limits: Record<string, number | null>) => ({
    receiptBytes: limits.receiptStorageBytes ?? null,
    syncDevices: limits.syncDevices ?? null,
    workspaceMembers: limits.workspaceMembers ?? null,
})

/**
 * The full picture of one subscriber. Opening it is itself audited (and capped per admin per hour), because
 * this is the one view that shows a full email and provider ids.
 */
export const getSubscriberDetail = async (
    userId: unknown,
    actor: AdminPrincipal,
    ctx: AdminRequestContext,
    now: Date = new Date()
) => {
    if (typeof userId !== 'string' || !OBJECT_ID.test(userId)) throw invalidQuery()

    const user = await findUserById(userId)
    if (!user) throw new CustomError(ERROR_MESSAGES.ADMIN.SUBSCRIBER_NOT_FOUND, 404)

    await assertUnderDetailCap(actor.id, now)

    const subscription = await findSubscriptionByUserId(userId)
    await recordAudit({
        adminId: actor.id,
        adminRole: actor.role,
        action: 'subscription.viewed',
        subjectUserId: userId,
        subjectSubscriptionId: subscription?._id ?? null,
        ip: ctx.ip,
        requestId: ctx.requestId,
        at: now,
    })

    const entitlements = await getUserEntitlementSnapshot(userId, now)
    const [devices, workspaces, counters, events, history] = await Promise.all([
        findDevices(userId),
        findOwnedWorkspaces(userId),
        findUsageCounters(userId),
        findBillingEventsFor(
            { providerCustomerId: subscription?.providerCustomerId ?? null, providerSubscriptionId: subscription?.providerSubscriptionId ?? null },
            DETAIL_EVENT_LIMIT
        ),
        AdminAuditLog.find({ subjectUserId: new Types.ObjectId(userId) })
            .sort({ at: -1, _id: -1 })
            .limit(DETAIL_HISTORY_LIMIT),
    ])

    const limits = flattenLimits(entitlements.limits)
    const deviceLimit = limits.syncDevices

    return {
        account: toSubscriberDetailAccount(user),
        legal: toSubscriberDetailLegal(user.legalAcceptance),
        subscription: subscription ? toSubscriberDetailSubscription(subscription) : null,
        entitlements: {
            billingEnabled: entitlements.billingEnabled,
            status: entitlements.status,
            planCode: entitlements.planCode,
            canWrite: entitlements.canWrite,
            canSyncPush: entitlements.canSyncPush,
            features: entitlements.features,
            limits: entitlements.limits,
            trialEndsAt: entitlements.trialEndsAt,
            currentPeriodEnd: entitlements.currentPeriodEnd,
            cancelAtPeriodEnd: entitlements.cancelAtPeriodEnd,
            graceEndsAt: entitlements.graceEndsAt,
            writableUntil: entitlements.writableUntil,
        },
        readOnly: explainWriteAccess(entitlements, subscription, now, { pastDueGraceDays: getPastDueGraceDays() }),
        usage: {
            receiptBytes: { used: counters.find((counter) => counter.resource === 'receiptBytes')?.value ?? 0, limit: limits.receiptBytes },
            syncDevices: { used: devices.length, limit: limits.syncDevices },
            workspaceMembers: {
                used: workspaces.reduce((largest, workspace) => Math.max(largest, workspace.members.length), 0),
                limit: limits.workspaceMembers,
            },
        },
        devices: devices.map((device, rank) => toDeviceView(device, deviceLimit === null || rank < deviceLimit)),
        workspaces: workspaces.map(toWorkspaceView),
        billingEvents: events.map(toBillingEventView),
        erasure: describeErasure(subscription, now),
        adminHistory: history.map(toHistoryEntryView),
    }
}
