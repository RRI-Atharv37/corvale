import type { Types } from 'mongoose'

import type { SubscriptionStatus } from '@core/billing/constants'
import type { IAdminAuditLog } from './adminAuditLog.model'

const idOf = (value: { toString(): string } | null | undefined): string | null => (value ? value.toString() : null)

export const maskEmail = (email: string): string => {
    const at = email.indexOf('@')
    if (at < 1) return '***'
    return `${email[0]}***${email.slice(at)}`
}

/** Provider ids identify a person at the payment provider, so lists carry only the last six characters. */
export const maskProviderId = (id: string | null | undefined): string | null => (id ? `…${id.slice(-6)}` : null)

/**
 * Every admin response is built here from an explicit key list, never by spreading a document: a field
 * added to a model tomorrow cannot reach an operator's screen unless someone adds it below on purpose
 * (`adminViews.test.ts` pins the exact key sets).
 */
export const toAuditEntryView = (row: IAdminAuditLog) => ({
    id: row._id.toString(),
    at: row.at,
    adminId: idOf(row.adminId),
    adminRole: row.adminRole ?? null,
    actorType: row.actorType,
    action: row.action,
    subjectUserId: idOf(row.subjectUserId),
    subjectSubscriptionId: idOf(row.subjectSubscriptionId),
    targetAdminId: idOf(row.targetAdminId),
    before: row.before ?? null,
    after: row.after ?? null,
    amountMinor: row.amountMinor ?? null,
    currency: row.currency ?? null,
    reason: row.reason ?? null,
    requestId: row.requestId ?? null,
    ip: row.ip ?? null,
})

/** What a support agent needs to see about past staff actions on one subscriber. */
export const toHistoryEntryView = (row: IAdminAuditLog) => ({
    id: row._id.toString(),
    at: row.at,
    action: row.action,
    adminId: idOf(row.adminId),
    adminRole: row.adminRole ?? null,
    before: row.before ?? null,
    after: row.after ?? null,
    reason: row.reason ?? null,
})

interface GrantLike {
    kind: string
    planCode?: string | null
    until: Date
    limits?: Partial<Record<string, number | null>> | null
    grantedBy?: { toString(): string } | null
    grantedAt?: Date | null
}

interface SubscriptionLike {
    _id: Types.ObjectId
    planCode: string
    status: string
    trialEndsAt: Date | null
    currentPeriodEnd: Date | null
    cancelAtPeriodEnd: boolean
    pastDueSince: Date | null
    dunningStage: string | null
    lapsedAt: Date | null
    retentionStage: string | null
    retentionStageAt: Date | null
    grandfatherKind: string | null
    adminGrant?: GrantLike | null
    retentionHoldUntil?: Date | null
    providerCustomerId: string | null
    providerSubscriptionId: string | null
    lastEventAt: Date | null
    createdAt: Date
    updatedAt: Date
}

const activeAt = (until: Date | null | undefined, now: Date): boolean => !!until && until.getTime() > now.getTime()

export const toSubscriberListItem = (input: {
    userId: string
    email: string
    subscription: SubscriptionLike | null
    resolvedStatus: SubscriptionStatus | 'none'
    canWrite: boolean
    now: Date
}) => {
    const { subscription: sub, now } = input
    return {
        userId: input.userId,
        email: maskEmail(input.email),
        planCode: sub?.planCode ?? null,
        status: sub?.status ?? null,
        resolvedStatus: input.resolvedStatus,
        canWrite: input.canWrite,
        trialEndsAt: sub?.trialEndsAt ?? null,
        currentPeriodEnd: sub?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
        pastDueSince: sub?.pastDueSince ?? null,
        dunningStage: sub?.dunningStage ?? null,
        retentionStage: sub?.retentionStage ?? null,
        grandfatherKind: sub?.grandfatherKind ?? null,
        hasAdminGrant: activeAt(sub?.adminGrant?.until, now),
        onRetentionHold: activeAt(sub?.retentionHoldUntil, now),
        providerLinked: typeof sub?.providerSubscriptionId === 'string',
        providerSubscriptionId: maskProviderId(sub?.providerSubscriptionId),
        lastEventAt: sub?.lastEventAt ?? null,
    }
}

export const toSubscriberDetailAccount = (user: { _id: Types.ObjectId; email: string; createdAt: Date; isEmailVerified: boolean }) => ({
    userId: user._id.toString(),
    email: user.email,
    createdAt: user.createdAt,
    isEmailVerified: user.isEmailVerified,
})

export const toSubscriberDetailLegal = (
    legal: { termsVersion: string; privacyVersion: string; acceptedAt: Date; ageAttested: boolean } | null | undefined
) => ({
    termsVersion: legal?.termsVersion ?? null,
    privacyVersion: legal?.privacyVersion ?? null,
    acceptedAt: legal?.acceptedAt ?? null,
    ageAttested: legal?.ageAttested ?? null,
})

/** The grant as staff see it: its structure, never the free-text reason (that lives in the audit log). */
export const toAdminGrantView = (grant: GrantLike | null | undefined) =>
    grant
        ? {
              kind: grant.kind,
              planCode: grant.planCode ?? null,
              until: grant.until,
              limits: grant.limits ? { ...grant.limits } : null,
              grantedBy: idOf(grant.grantedBy),
              grantedAt: grant.grantedAt ?? null,
          }
        : null

export const toSubscriberDetailSubscription = (sub: SubscriptionLike) => ({
    id: sub._id.toString(),
    planCode: sub.planCode,
    status: sub.status,
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    pastDueSince: sub.pastDueSince,
    dunningStage: sub.dunningStage,
    lapsedAt: sub.lapsedAt,
    retentionStage: sub.retentionStage,
    retentionStageAt: sub.retentionStageAt,
    grandfatherKind: sub.grandfatherKind,
    adminGrant: toAdminGrantView(sub.adminGrant),
    retentionHoldUntil: sub.retentionHoldUntil ?? null,
    providerCustomerId: sub.providerCustomerId,
    providerSubscriptionId: sub.providerSubscriptionId,
    lastEventAt: sub.lastEventAt,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
})

/** A batch as staff see it in the revert list: its criteria and outcome, never the sampled emails (those only ever appear in the dry-run response). */
export const toGrandfatherBatchView = (batch: {
    _id: Types.ObjectId
    kind: string
    registeredBefore: Date
    reason: string
    status: string
    subscriptionIds: unknown[]
    createdBy: { toString(): string } | null
    createdAt: Date
    revertedBy?: { toString(): string } | null
    revertedAt?: Date | null
    revertReason?: string | null
}) => ({
    id: batch._id.toString(),
    kind: batch.kind,
    registeredBefore: batch.registeredBefore,
    reason: batch.reason,
    status: batch.status,
    count: batch.subscriptionIds.length,
    createdBy: idOf(batch.createdBy),
    createdAt: batch.createdAt,
    revertedBy: idOf(batch.revertedBy),
    revertedAt: batch.revertedAt ?? null,
    revertReason: batch.revertReason ?? null,
})

const DEVICE_REF_LENGTH = 8

/** The chosen name is free text and can be personal, so a device is shown only by a short id and its kind. */
export const toDeviceView = (
    device: { deviceId: string; kind?: string | null; firstSeenAt: Date; lastSeenAt: Date },
    canPush: boolean
) => ({
    deviceRef: device.deviceId.slice(0, DEVICE_REF_LENGTH),
    kind: device.kind ?? null,
    firstSeenAt: device.firstSeenAt,
    lastSeenAt: device.lastSeenAt,
    canPush,
})

/** Ids and seat counts only: a workspace name can describe a family or a business. */
export const toWorkspaceView = (workspace: { _id: Types.ObjectId; members: unknown[] }) => ({
    id: workspace._id.toString(),
    seatCount: workspace.members.length,
})

const EVENT_PAYLOAD_KEYS = [
    'planCode',
    'status',
    'currentPeriodEnd',
    'trialEndsAt',
    'cancelAtPeriodEnd',
    'providerEventName',
    'providerStatus',
    'cancelled',
    'renewsAt',
    'endsAt',
    'billingReason',
    'total',
    'currency',
    'refunded',
] as const

const MAX_PAYLOAD_STRING = 100
const MAX_EVENT_ERROR = 300

const minimisePayload = (payload: Record<string, unknown> | null | undefined): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const key of EVENT_PAYLOAD_KEYS) {
        const value = payload?.[key]
        if (typeof value === 'string') {
            if (!value.includes('@')) out[key] = value.slice(0, MAX_PAYLOAD_STRING)
        } else if (typeof value === 'number' || typeof value === 'boolean') {
            out[key] = value
        }
    }
    return out
}

export const toBillingEventView = (event: {
    _id: Types.ObjectId
    type: string
    occurredAt: Date
    processedAt: Date | null
    error: string | null
    redactedAt?: Date | null
    payload?: Record<string, unknown> | null
}) => ({
    id: event._id.toString(),
    type: event.type,
    occurredAt: event.occurredAt,
    processedAt: event.processedAt,
    error: event.error ? event.error.slice(0, MAX_EVENT_ERROR) : null,
    redacted: event.redactedAt !== null && event.redactedAt !== undefined,
    payload: minimisePayload(event.payload),
})
