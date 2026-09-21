import { isPlanUpgrade } from '@core/billing/adminGrant'
import { ADMIN_GRANT_KINDS, LIMIT_KEYS, PLAN_CODES, type AdminGrantKind, type LimitKey, type PlanCode } from '@core/billing/entitlements'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { getPlanDefinition } from '@modules/billing'

import { recordAudit, validateReason } from './adminAudit.service'
import { getErasureHoldCapDays, getGrantCapDays } from './adminConfig'
import {
    findSubscriptionByUserId,
    reopenTrial,
    replaceAdminGrant,
    replaceRetentionHold,
    type SubscriptionRow,
} from './adminData.service'
import type { AdminPrincipal, AdminRequestContext } from './adminTypes'
import { toAdminGrantView } from './adminViews'

const DAY_MS = 24 * 60 * 60 * 1000
const OBJECT_ID = /^[0-9a-f]{24}$/i

const invalidGrant = (): CustomError => new CustomError(ERROR_MESSAGES.ADMIN.INVALID_GRANT, 400)

const requireUserId = (value: unknown): string => {
    if (typeof value !== 'string' || !OBJECT_ID.test(value)) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_QUERY, 400)
    return value
}

const requireSubscription = async (userId: string): Promise<SubscriptionRow> => {
    const subscription = await findSubscriptionByUserId(userId)
    if (!subscription) throw new CustomError(ERROR_MESSAGES.ADMIN.SUBSCRIBER_NOT_FOUND, 404)
    return subscription
}

/** A whole number of days from 1 to the role's cap. Anything else, including a numeric string, is refused. */
const parseDays = (value: unknown, cap: number): number => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw invalidGrant()
    if (value > cap) throw new CustomError(ERROR_MESSAGES.ADMIN.GRANT_CAP_EXCEEDED, 400)
    return value
}

const parsePlanCode = (value: unknown): PlanCode => {
    if (typeof value !== 'string' || !(PLAN_CODES as readonly string[]).includes(value)) throw invalidGrant()
    return value as PlanCode
}

const parseLimits = (value: unknown): Partial<Record<LimitKey, number | null>> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalidGrant()

    const out: Partial<Record<LimitKey, number | null>> = {}
    for (const [key, limit] of Object.entries(value)) {
        if (!(LIMIT_KEYS as readonly string[]).includes(key)) throw invalidGrant()
        if (limit !== null && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0)) throw invalidGrant()
        out[key as LimitKey] = limit
    }
    if (Object.keys(out).length === 0) throw invalidGrant()
    return out
}

interface GrantInput {
    kind?: unknown
    planCode?: unknown
    days?: unknown
    limits?: unknown
    reason?: unknown
}

const auditBase = (actor: AdminPrincipal, ctx: AdminRequestContext, userId: string, subscription: SubscriptionRow, now: Date) => ({
    adminId: actor.id,
    adminRole: actor.role,
    subjectUserId: userId,
    subjectSubscriptionId: subscription._id,
    ip: ctx.ip,
    requestId: ctx.requestId,
    at: now,
})

/**
 * Comp or plan override. Both write only `Subscription.adminGrant`, an overlay the resolver takes the better
 * of, so a later webhook cannot undo it and reconciliation does not read it as drift. A comp can lift a
 * read-only account; an override may only raise what the customer's own plan gives.
 */
export const applyGrant = async (
    actor: AdminPrincipal,
    userIdParam: unknown,
    input: GrantInput,
    ctx: AdminRequestContext,
    now: Date = new Date()
) => {
    const userId = requireUserId(userIdParam)
    if (typeof input.kind !== 'string' || !(ADMIN_GRANT_KINDS as readonly string[]).includes(input.kind)) throw invalidGrant()
    const kind = input.kind as AdminGrantKind
    const days = parseDays(input.days, getGrantCapDays(actor.role))
    const reason = validateReason(input.reason)

    let planCode: PlanCode | null = null
    let limits: Partial<Record<LimitKey, number | null>> | null = null
    if (kind === 'comp') {
        if (input.limits !== undefined) throw invalidGrant()
        planCode = parsePlanCode(input.planCode)
    } else {
        if (input.planCode !== undefined && input.planCode !== null) planCode = parsePlanCode(input.planCode)
        if (input.limits !== undefined) limits = parseLimits(input.limits)
        if (planCode === null && limits === null) throw invalidGrant()
    }

    const subscription = await requireSubscription(userId)

    if (kind === 'plan_override') {
        const basePlan = await getPlanDefinition(subscription.planCode)
        if (!basePlan || !isPlanUpgrade({ planCode, limits }, basePlan)) throw new CustomError(ERROR_MESSAGES.ADMIN.GRANT_NOT_UPGRADE, 400)
    }

    const grant = {
        kind,
        planCode,
        until: new Date(now.getTime() + days * DAY_MS),
        limits,
        grantedBy: actor.id,
        grantedAt: now,
    }
    const previous = await replaceAdminGrant(userId, grant)
    if (!previous) throw new CustomError(ERROR_MESSAGES.ADMIN.SUBSCRIBER_NOT_FOUND, 404)

    await recordAudit({
        ...auditBase(actor, ctx, userId, subscription, now),
        action: kind === 'comp' ? 'grant.comp' : 'grant.plan_override',
        before: { adminGrant: previous.adminGrant ?? null },
        after: { adminGrant: grant },
        reason,
    })

    return { adminGrant: toAdminGrantView(grant) }
}

export const revokeGrant = async (
    actor: AdminPrincipal,
    userIdParam: unknown,
    input: { reason?: unknown },
    ctx: AdminRequestContext,
    now: Date = new Date()
) => {
    const userId = requireUserId(userIdParam)
    const reason = validateReason(input.reason)
    const subscription = await requireSubscription(userId)
    if (!subscription.adminGrant) throw new CustomError(ERROR_MESSAGES.ADMIN.NO_GRANT, 404)

    await replaceAdminGrant(userId, null)
    await recordAudit({
        ...auditBase(actor, ctx, userId, subscription, now),
        action: 'grant.revoked',
        before: { adminGrant: subscription.adminGrant },
        after: { adminGrant: null },
        reason,
    })

    return { adminGrant: null }
}

const TRIAL_STATUSES = ['trialing', 'trial_expired'] as const

/**
 * Trial state is Corvale's own (`trial.service.ts`), so this is a direct write - but only for a trial with no
 * payment-provider link, and never past the role's cap counted from today.
 */
export const extendTrial = async (
    actor: AdminPrincipal,
    userIdParam: unknown,
    input: { days?: unknown; reason?: unknown },
    ctx: AdminRequestContext,
    now: Date = new Date()
) => {
    const userId = requireUserId(userIdParam)
    const cap = getGrantCapDays(actor.role)
    const days = parseDays(input.days, cap)
    const reason = validateReason(input.reason)
    const subscription = await requireSubscription(userId)

    const linked = subscription.providerSubscriptionId !== null || subscription.providerCustomerId !== null
    if (linked || !(TRIAL_STATUSES as readonly string[]).includes(subscription.status)) {
        throw new CustomError(ERROR_MESSAGES.ADMIN.TRIAL_NOT_EXTENDABLE, 400)
    }

    const runningUntil = subscription.status === 'trialing' && subscription.trialEndsAt && subscription.trialEndsAt > now ? subscription.trialEndsAt : now
    const trialEndsAt = new Date(runningUntil.getTime() + days * DAY_MS)
    if (trialEndsAt.getTime() - now.getTime() > cap * DAY_MS) throw new CustomError(ERROR_MESSAGES.ADMIN.GRANT_CAP_EXCEEDED, 400)

    const previous = await reopenTrial(userId, subscription.status, trialEndsAt)
    if (!previous) throw new CustomError(ERROR_MESSAGES.ADMIN.TRIAL_NOT_EXTENDABLE, 400)

    await recordAudit({
        ...auditBase(actor, ctx, userId, subscription, now),
        action: 'trial.extended',
        before: { status: previous.status, trialEndsAt: previous.trialEndsAt },
        after: { status: 'trialing', trialEndsAt },
        reason,
    })

    return { status: 'trialing', trialEndsAt }
}

/** Keeps the retention job from erasing a lapsed account for a while. It changes nothing about what the customer may do. */
export const setErasureHold = async (
    actor: AdminPrincipal,
    userIdParam: unknown,
    input: { days?: unknown; reason?: unknown },
    ctx: AdminRequestContext,
    now: Date = new Date()
) => {
    const userId = requireUserId(userIdParam)
    const days = parseDays(input.days, getErasureHoldCapDays(actor.role))
    const reason = validateReason(input.reason)
    const subscription = await requireSubscription(userId)

    const retentionHoldUntil = new Date(now.getTime() + days * DAY_MS)
    await replaceRetentionHold(userId, retentionHoldUntil)

    await recordAudit({
        ...auditBase(actor, ctx, userId, subscription, now),
        action: 'erasure.hold_set',
        before: { retentionHoldUntil: subscription.retentionHoldUntil ?? null },
        after: { retentionHoldUntil },
        reason,
    })

    return { retentionHoldUntil }
}

export const clearErasureHold = async (
    actor: AdminPrincipal,
    userIdParam: unknown,
    input: { reason?: unknown },
    ctx: AdminRequestContext,
    now: Date = new Date()
) => {
    const userId = requireUserId(userIdParam)
    const reason = validateReason(input.reason)
    const subscription = await requireSubscription(userId)
    if (!subscription.retentionHoldUntil) throw new CustomError(ERROR_MESSAGES.ADMIN.NO_HOLD, 404)

    await replaceRetentionHold(userId, null)
    await recordAudit({
        ...auditBase(actor, ctx, userId, subscription, now),
        action: 'erasure.hold_cleared',
        before: { retentionHoldUntil: subscription.retentionHoldUntil },
        after: { retentionHoldUntil: null },
        reason,
    })

    return { retentionHoldUntil: null }
}
