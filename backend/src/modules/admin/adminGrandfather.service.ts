import { Types } from 'mongoose'

import { GRANDFATHER_KINDS, type GrandfatherKind } from '@core/billing/constants'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

import { recordAudit, validateReason } from './adminAudit.service'
import {
    applyCohortGrandfather,
    countCohortSubscriptions,
    findCohortSubscriptions,
    findSubscriptionByUserId,
    findUserEmails,
    findUserIdsRegisteredBefore,
    replaceGrandfatherKind,
    revertCohortGrandfather,
    type SubscriptionRow,
} from './adminData.service'
import type { AdminPrincipal, AdminRequestContext } from './adminTypes'
import { maskEmail, toGrandfatherBatchView } from './adminViews'
import GrandfatherBatch, { type IGrandfatherBatch } from './grandfatherBatch.model'

const OBJECT_ID = /^[0-9a-f]{24}$/i
const COHORT_SAMPLE_SIZE = 5
const BATCH_LIST_LIMIT = 100

const invalidGrandfather = (): CustomError => new CustomError(ERROR_MESSAGES.ADMIN.INVALID_GRANDFATHER, 400)

const requireUserId = (value: unknown): string => {
    if (typeof value !== 'string' || !OBJECT_ID.test(value)) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_QUERY, 400)
    return value
}

const requireSubscription = async (userId: string): Promise<SubscriptionRow> => {
    const subscription = await findSubscriptionByUserId(userId)
    if (!subscription) throw new CustomError(ERROR_MESSAGES.ADMIN.SUBSCRIBER_NOT_FOUND, 404)
    return subscription
}

const parseKind = (value: unknown): GrandfatherKind => {
    if (typeof value !== 'string' || !(GRANDFATHER_KINDS as readonly string[]).includes(value)) throw invalidGrandfather()
    return value as GrandfatherKind
}

/** A whole calendar cutoff no later than today - a bulk cohort is always about the past, never a future signup window. */
const parseCutoff = (value: unknown, now: Date): Date => {
    if (typeof value !== 'string') throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_COHORT_CRITERIA, 400)
    const date = new Date(value)
    if (Number.isNaN(date.getTime()) || date.getTime() > now.getTime()) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_COHORT_CRITERIA, 400)
    return date
}

const auditBase = (actor: AdminPrincipal, ctx: AdminRequestContext, now: Date) => ({
    adminId: actor.id,
    adminRole: actor.role,
    ip: ctx.ip,
    requestId: ctx.requestId,
    at: now,
})

// -------- single subscriber --------

export const setGrandfather = async (
    actor: AdminPrincipal,
    userIdParam: unknown,
    input: { kind?: unknown; reason?: unknown },
    ctx: AdminRequestContext,
    now: Date = new Date()
) => {
    const userId = requireUserId(userIdParam)
    const kind = parseKind(input.kind)
    const reason = validateReason(input.reason)
    const subscription = await requireSubscription(userId)

    const previous = await replaceGrandfatherKind(userId, kind)
    if (!previous) throw new CustomError(ERROR_MESSAGES.ADMIN.SUBSCRIBER_NOT_FOUND, 404)

    await recordAudit({
        ...auditBase(actor, ctx, now),
        subjectUserId: userId,
        subjectSubscriptionId: subscription._id,
        action: 'grandfather.set',
        before: { grandfatherKind: previous.grandfatherKind },
        after: { grandfatherKind: kind },
        reason,
    })

    return { grandfatherKind: kind }
}

export const revokeGrandfather = async (
    actor: AdminPrincipal,
    userIdParam: unknown,
    input: { reason?: unknown },
    ctx: AdminRequestContext,
    now: Date = new Date()
) => {
    const userId = requireUserId(userIdParam)
    const reason = validateReason(input.reason)
    const subscription = await requireSubscription(userId)
    if (!subscription.grandfatherKind) throw new CustomError(ERROR_MESSAGES.ADMIN.NO_GRANDFATHER, 404)

    await replaceGrandfatherKind(userId, null)
    await recordAudit({
        ...auditBase(actor, ctx, now),
        subjectUserId: userId,
        subjectSubscriptionId: subscription._id,
        action: 'grandfather.revoked',
        before: { grandfatherKind: subscription.grandfatherKind },
        after: { grandfatherKind: null },
        reason,
    })

    return { grandfatherKind: null }
}

// -------- bulk cohort --------

interface CohortInput {
    kind?: unknown
    registeredBefore?: unknown
    reason?: unknown
}

const resolveCohort = (registeredBefore: Date) => findUserIdsRegisteredBefore(registeredBefore)

/** Preview only: never audited, the same way the subscriber list page is never audited - it shows masked emails, not a full detail view. */
export const previewGrandfatherCohort = async (input: CohortInput, now: Date = new Date()) => {
    const kind = parseKind(input.kind)
    const registeredBefore = parseCutoff(input.registeredBefore, now)

    const userIds = await resolveCohort(registeredBefore)
    const [count, sampleRows] = await Promise.all([countCohortSubscriptions(userIds), findCohortSubscriptions(userIds, COHORT_SAMPLE_SIZE)])
    const emails = await findUserEmails(sampleRows.map((row) => row.userId))
    const sample = sampleRows.map((row) => maskEmail(emails.get(row.userId.toString()) ?? ''))

    return { kind, registeredBefore, count, sample }
}

export const applyGrandfatherCohort = async (
    actor: AdminPrincipal,
    input: CohortInput & { confirmCount?: unknown },
    ctx: AdminRequestContext,
    now: Date = new Date()
) => {
    const kind = parseKind(input.kind)
    const registeredBefore = parseCutoff(input.registeredBefore, now)
    const reason = validateReason(input.reason)
    if (typeof input.confirmCount !== 'number' || !Number.isInteger(input.confirmCount) || input.confirmCount < 0) {
        throw new CustomError(ERROR_MESSAGES.ADMIN.COHORT_CONFIRM_REQUIRED, 400)
    }

    const userIds = await resolveCohort(registeredBefore)
    const rows = await findCohortSubscriptions(userIds)
    if (rows.length === 0) throw new CustomError(ERROR_MESSAGES.ADMIN.COHORT_EMPTY, 400)
    if (input.confirmCount !== rows.length) throw new CustomError(ERROR_MESSAGES.ADMIN.COHORT_COUNT_MISMATCH, 409)

    const subscriptionIds = rows.map((row) => row._id)
    const appliedCount = await applyCohortGrandfather(subscriptionIds, kind)

    const batch = await GrandfatherBatch.create({
        kind,
        registeredBefore,
        reason,
        status: 'applied',
        subscriptionIds,
        createdBy: new Types.ObjectId(actor.id),
    })

    await recordAudit({
        ...auditBase(actor, ctx, now),
        action: 'grandfather.bulk_applied',
        before: null,
        after: { grandfatherKind: kind, batchId: batch._id.toString(), affectedCount: appliedCount },
        reason,
    })

    return { batchId: batch._id.toString(), appliedCount }
}

export const revertGrandfatherCohort = async (
    actor: AdminPrincipal,
    batchIdParam: unknown,
    input: { reason?: unknown },
    ctx: AdminRequestContext,
    now: Date = new Date()
) => {
    if (typeof batchIdParam !== 'string' || !OBJECT_ID.test(batchIdParam)) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_QUERY, 400)
    const reason = validateReason(input.reason)

    const batch = await GrandfatherBatch.findById(batchIdParam)
    if (!batch) throw new CustomError(ERROR_MESSAGES.ADMIN.BATCH_NOT_FOUND, 404)
    if (batch.status !== 'applied') throw new CustomError(ERROR_MESSAGES.ADMIN.BATCH_NOT_APPLIED, 400)

    const revertedCount = await revertCohortGrandfather(batch.subscriptionIds, batch.kind)

    batch.status = 'reverted'
    batch.revertedBy = new Types.ObjectId(actor.id)
    batch.revertedAt = now
    batch.revertReason = reason
    await batch.save()

    await recordAudit({
        ...auditBase(actor, ctx, now),
        action: 'grandfather.bulk_reverted',
        before: { grandfatherKind: batch.kind },
        after: { grandfatherKind: null, batchId: batch._id.toString(), affectedCount: revertedCount },
        reason,
    })

    return { batchId: batch._id.toString(), revertedCount }
}

export const listGrandfatherBatches = async (): Promise<ReturnType<typeof toGrandfatherBatchView>[]> => {
    const batches = await GrandfatherBatch.find().sort({ createdAt: -1 }).limit(BATCH_LIST_LIMIT).lean<IGrandfatherBatch[]>()
    return batches.map(toGrandfatherBatchView)
}
