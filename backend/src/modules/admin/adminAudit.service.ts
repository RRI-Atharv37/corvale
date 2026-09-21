import { Types } from 'mongoose'

import { LIMIT_KEYS } from '@core/billing/constants'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

import AdminAuditLog, {
    ADMIN_AUDIT_ACTIONS,
    type IAdminAuditLog,
    AUDIT_ERASURE_REDACTION,
    AUDIT_IP_SCRUB,
    REDACTED_REASON,
    type AdminAuditAction,
    type AuditActorType,
} from './adminAuditLog.model'
import type { AdminRole } from './adminRoles'

const DAY_MS = 24 * 60 * 60 * 1000
export const AUDIT_ROW_RETENTION_DAYS = 400
export const AUDIT_IP_RETENTION_DAYS = 90

/** Money and permanent actions are kept with the row; the retention period is set by the M8 finance runbook. */
const KEPT_WITH_ROW: ReadonlySet<AdminAuditAction> = new Set<AdminAuditAction>([
    'grant.comp',
    'grant.plan_override',
    'admin.bootstrap',
    'admin.break_glass',
    'admin.invited',
    'admin.totp_reset',
    'admin.status_changed',
])

const ALLOWED_STATE_KEYS = [
    'planCode',
    'status',
    'interval',
    'trialEndsAt',
    'currentPeriodEnd',
    'cancelAtPeriodEnd',
    'pastDueSince',
    'grandfatherKind',
    'retentionHoldUntil',
    'role',
    'adminGrant',
] as const

const EMAIL_IN_TEXT = /[^\s@]+@[^\s@]+\.[^\s@]+/

const isScalar = (value: unknown): value is string | number | boolean | null =>
    value === null || ['string', 'number', 'boolean'].includes(typeof value)

const toWire = (value: unknown): unknown => (value instanceof Date ? value.toISOString() : value)

const sanitizeLimits = (limits: unknown): Record<string, number | null> | undefined => {
    if (typeof limits !== 'object' || limits === null) return undefined

    const out: Record<string, number | null> = {}
    for (const key of LIMIT_KEYS) {
        const value = (limits as Record<string, unknown>)[key]
        if (value === null || typeof value === 'number') out[key] = value
    }
    return Object.keys(out).length > 0 ? out : undefined
}

const sanitizeGrant = (grant: unknown): Record<string, unknown> | null => {
    if (typeof grant !== 'object' || grant === null) return null

    const source = grant as Record<string, unknown>
    const out: Record<string, unknown> = {}
    if (typeof source.kind === 'string') out.kind = source.kind
    if (typeof source.planCode === 'string') out.planCode = source.planCode
    if (source.until instanceof Date || typeof source.until === 'string') out.until = toWire(source.until)
    const limits = sanitizeLimits(source.limits)
    if (limits) out.limits = limits
    return out
}

/**
 * Only structural billing fields survive. There is no path for a provider id, an email or free text to
 * reach the log through here: unknown keys are dropped rather than trusted.
 */
export const sanitizeAuditState = (state: Record<string, unknown> | null | undefined): Record<string, unknown> | null => {
    if (!state) return null

    const out: Record<string, unknown> = {}
    for (const key of ALLOWED_STATE_KEYS) {
        if (!(key in state)) continue

        const value = state[key]
        if (key === 'adminGrant') {
            out.adminGrant = sanitizeGrant(value)
        } else if (value instanceof Date) {
            out[key] = value.toISOString()
        } else if (isScalar(value)) {
            out[key] = value
        }
    }
    return out
}

export const validateReason = (value: unknown): string => {
    if (typeof value !== 'string') throw new CustomError(ERROR_MESSAGES.ADMIN.REASON_REQUIRED, 400)

    const reason = value.trim()
    if (reason.length < 10 || reason.length > 500) throw new CustomError(ERROR_MESSAGES.ADMIN.REASON_REQUIRED, 400)
    if (EMAIL_IN_TEXT.test(reason)) throw new CustomError(ERROR_MESSAGES.ADMIN.REASON_CONTAINS_EMAIL, 400)
    return reason
}

type IdLike = Types.ObjectId | string | null | undefined

export interface AuditEntry {
    adminId?: IdLike
    adminRole?: AdminRole | null
    actorType?: AuditActorType
    action: AdminAuditAction
    subjectUserId?: IdLike
    subjectSubscriptionId?: IdLike
    targetAdminId?: IdLike
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
    amountMinor?: number | null
    currency?: string | null
    reason?: string | null
    requestId?: string | null
    ip?: string | null
    at?: Date
}

const toId = (value: IdLike): Types.ObjectId | null => (value ? new Types.ObjectId(value) : null)

export const recordAudit = async (entry: AuditEntry): Promise<void> => {
    if (!(ADMIN_AUDIT_ACTIONS as readonly string[]).includes(entry.action)) {
        throw new Error(`Unknown audit action: ${entry.action}`)
    }

    const at = entry.at ?? new Date()
    await AdminAuditLog.create({
        adminId: toId(entry.adminId),
        adminRole: entry.adminRole ?? null,
        actorType: entry.actorType ?? 'admin',
        action: entry.action,
        subjectUserId: toId(entry.subjectUserId),
        subjectSubscriptionId: toId(entry.subjectSubscriptionId),
        targetAdminId: toId(entry.targetAdminId),
        before: sanitizeAuditState(entry.before),
        after: sanitizeAuditState(entry.after),
        amountMinor: entry.amountMinor ?? null,
        currency: entry.currency ?? null,
        reason: entry.reason ?? null,
        requestId: entry.requestId ?? null,
        ip: entry.ip ?? null,
        at,
        expireAt: KEPT_WITH_ROW.has(entry.action) ? null : new Date(at.getTime() + AUDIT_ROW_RETENTION_DAYS * DAY_MS),
    })
}

/**
 * Account erasure (D5): the accountability record stays - who acted, what, when, the billing diff - but
 * every link to the person goes, and so does the free-text reason (staff may have typed something about them).
 */
const ERASURE_OPTIONS = { timestamps: false, [AUDIT_ERASURE_REDACTION]: true }
const IP_SCRUB_OPTIONS = { timestamps: false, [AUDIT_IP_SCRUB]: true }

export const redactAdminAuditSubject = async (userId: string): Promise<number> => {
    const result = await AdminAuditLog.updateMany(
        { subjectUserId: new Types.ObjectId(userId) },
        { $set: { subjectUserId: null, subjectSubscriptionId: null, reason: REDACTED_REASON } },
        ERASURE_OPTIONS
    )
    return result.modifiedCount
}

/** The admin's own address is kept 90 days for incident investigation, then only the field is removed. */
export const scrubAuditIps = async (now: Date = new Date()): Promise<number> => {
    const result = await AdminAuditLog.updateMany(
        { at: { $lt: new Date(now.getTime() - AUDIT_IP_RETENTION_DAYS * DAY_MS) }, ip: { $type: 'string' } },
        { $unset: { ip: 1 } },
        IP_SCRUB_OPTIONS
    )
    return result.modifiedCount
}

const MAX_AUDIT_PAGE_SIZE = 100
const DEFAULT_AUDIT_PAGE_SIZE = 25

const singleQueryValue = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

const boundedInt = (value: unknown, fallback: number, min: number, max: number): number => {
    const raw = singleQueryValue(value)
    if (raw === undefined) return fallback

    const parsed = Number(raw)
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_QUERY, 400)
    return parsed
}

export const parsePagination = (query: Record<string, unknown>, defaultLimit = DEFAULT_AUDIT_PAGE_SIZE): { page: number; limit: number } => ({
    page: boundedInt(query.page, 1, 1, 100000),
    limit: boundedInt(query.limit, defaultLimit, 1, MAX_AUDIT_PAGE_SIZE),
})

export const listAuditEntries = async (
    query: Record<string, unknown>
): Promise<{ entries: IAdminAuditLog[]; total: number; page: number; limit: number }> => {
    const { page, limit } = parsePagination(query)
    const filter: Record<string, unknown> = {}

    const action = singleQueryValue(query.action)
    if (action !== undefined) {
        if (!(ADMIN_AUDIT_ACTIONS as readonly string[]).includes(action)) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_QUERY, 400)
        filter.action = action
    }
    for (const key of ['adminId', 'subjectUserId'] as const) {
        const value = singleQueryValue(query[key])
        if (value === undefined) continue
        if (!Types.ObjectId.isValid(value)) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_QUERY, 400)
        filter[key] = new Types.ObjectId(value)
    }

    const [entries, total] = await Promise.all([
        AdminAuditLog.find(filter)
            .sort({ at: -1, _id: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean<IAdminAuditLog[]>(),
        AdminAuditLog.countDocuments(filter),
    ])
    return { entries, total, page, limit }
}
