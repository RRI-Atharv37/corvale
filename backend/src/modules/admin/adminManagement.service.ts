import { Types } from 'mongoose'

import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { isDuplicateKeyError } from '@core/db/objectId'
import { EMAIL_REGEX } from '@infra/mail/emailUtils'

import { recordAudit, validateReason } from './adminAudit.service'
import {
    beginReenrolment,
    countActiveOwners,
    issueEnrolmentToken,
    notifyAdminSecurityEvent,
    type EnrolmentGrant,
} from './adminBootstrap.service'
import { INVITE_TOKEN_TTL_MS } from './adminConfig'
import { isAdminRole, type AdminRole, type AdminStatus } from './adminRoles'
import { revokeAdminSessions } from './adminSession.service'
import type { AdminPrincipal, AdminRequestContext } from './adminTypes'
import AdminUser, { type IAdminUser } from './adminUser.model'

export interface AdminListItem {
    id: string
    email: string
    role: AdminRole
    status: AdminStatus
    lastLoginAt: Date | null
    moneyBlockedUntil: Date | null
    createdAt: Date
}

const toListItem = (admin: IAdminUser): AdminListItem => ({
    id: admin._id.toString(),
    email: admin.email,
    role: admin.role,
    status: admin.status,
    lastLoginAt: admin.lastLoginAt,
    moneyBlockedUntil: admin.moneyBlockedUntil,
    createdAt: admin.createdAt,
})

const requireObjectId = (value: unknown): string => {
    if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
        throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_QUERY, 400)
    }
    return value
}

export const listAdmins = async (): Promise<AdminListItem[]> => {
    const admins = await AdminUser.find({}).sort({ createdAt: 1 })
    return admins.map(toListItem)
}

export const inviteAdmin = async (
    actor: AdminPrincipal,
    input: { email?: unknown; role?: unknown; reason?: unknown },
    ctx: AdminRequestContext,
    now: Date = new Date()
): Promise<EnrolmentGrant> => {
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
    if (!EMAIL_REGEX.test(email)) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_EMAIL, 400)
    if (!isAdminRole(input.role)) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_ROLE, 400)
    const reason = validateReason(input.reason)

    const token = issueEnrolmentToken(INVITE_TOKEN_TTL_MS, now)
    let created: IAdminUser
    try {
        created = await AdminUser.create({
            email,
            role: input.role,
            status: 'pending',
            invitedBy: actor.id,
            enrolmentTokenHash: token.hash,
            enrolmentExpiresAt: token.expiresAt,
        })
    } catch (error) {
        if (isDuplicateKeyError(error)) throw new CustomError(ERROR_MESSAGES.ADMIN.ADMIN_EMAIL_TAKEN, 409)
        throw error
    }

    await recordAudit({
        adminId: actor.id,
        adminRole: actor.role,
        action: 'admin.invited',
        targetAdminId: created._id,
        after: { role: created.role, status: 'pending' },
        reason,
        ip: ctx.ip,
        requestId: ctx.requestId,
        at: now,
    })

    return { adminId: created._id.toString(), enrolmentToken: token.token, expiresAt: token.expiresAt }
}

const loadTarget = async (adminId: unknown): Promise<IAdminUser> => {
    const target = await AdminUser.findById(requireObjectId(adminId))
    if (!target) throw new CustomError(ERROR_MESSAGES.ADMIN.ADMIN_NOT_FOUND, 404)
    return target
}

/** An owner resets someone else's authenticator; nobody can do it to themselves through the app. */
export const resetAdminTotp = async (
    actor: AdminPrincipal,
    targetId: unknown,
    input: { reason?: unknown },
    ctx: AdminRequestContext,
    now: Date = new Date()
): Promise<EnrolmentGrant> => {
    const id = requireObjectId(targetId)
    if (id === actor.id) throw new CustomError(ERROR_MESSAGES.ADMIN.CANNOT_TARGET_SELF, 400)
    const reason = validateReason(input.reason)

    const target = await loadTarget(id)
    if (target.status !== 'active' && target.status !== 'reenrol') throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_STATUS, 400)

    const grant = await beginReenrolment(id, now)
    await recordAudit({
        adminId: actor.id,
        adminRole: actor.role,
        action: 'admin.totp_reset',
        targetAdminId: target._id,
        before: { status: target.status },
        after: { status: 'reenrol' },
        reason,
        ip: ctx.ip,
        requestId: ctx.requestId,
        at: now,
    })
    await notifyAdminSecurityEvent([target.email], 'totp_reset', now)

    return grant
}

export const setAdminStatus = async (
    actor: AdminPrincipal,
    targetId: unknown,
    input: { status?: unknown; reason?: unknown },
    ctx: AdminRequestContext,
    now: Date = new Date()
): Promise<AdminListItem> => {
    const id = requireObjectId(targetId)
    if (input.status !== 'active' && input.status !== 'disabled') throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_STATUS, 400)
    const reason = validateReason(input.reason)
    const target = await loadTarget(id)

    if (input.status === 'active') {
        if (target.status !== 'disabled' || !target.passwordHash || !target.totpSecretEnc) {
            throw new CustomError(ERROR_MESSAGES.ADMIN.CANNOT_ENABLE_UNENROLLED, 400)
        }
    } else if (target.role === 'owner' && target.status === 'active' && (await countActiveOwners(id)) === 0) {
        throw new CustomError(ERROR_MESSAGES.ADMIN.LAST_OWNER, 409)
    }

    const before = target.status
    target.status = input.status
    if (input.status === 'disabled') {
        target.enrolmentTokenHash = null
        target.enrolmentExpiresAt = null
    }
    await target.save()
    if (input.status === 'disabled') await revokeAdminSessions(id, now)

    await recordAudit({
        adminId: actor.id,
        adminRole: actor.role,
        action: 'admin.status_changed',
        targetAdminId: target._id,
        before: { status: before },
        after: { status: input.status },
        reason,
        ip: ctx.ip,
        requestId: ctx.requestId,
        at: now,
    })

    return toListItem(target)
}
