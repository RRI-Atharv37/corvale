import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { openSecret, sealSecret } from '@core/auth/secretBox'
import {
    RECOVERY_CODE_COUNT,
    generateRecoveryCodes,
    normalizeRecoveryCode,
    sha256Hex,
} from '@core/auth/tokenHash'
import { buildOtpauthUri, generateTotpSecret, verifyTotp } from '@core/auth/totp'

import { recordAudit } from './adminAudit.service'
import {
    REENROL_MONEY_BLOCK_MS,
    getAccessTokenTtlSeconds,
    getAdminTotpKey,
    getLockoutMs,
    getMaxFailedLogins,
    getStepUpWindowMs,
} from './adminConfig'
import { hashAdminPassword, validateAdminPassword, verifyAdminPassword } from './adminPassword'
import {
    createAdminSession,
    markStepUp,
    revokeAdminSessions,
    revokeSessionById,
    revokeSessionByRefreshToken,
    rotateAdminSession,
    signAdminAccessToken,
    verifyAdminAccessToken,
} from './adminSession.service'
import AdminUser, { type IAdminUser } from './adminUser.model'
import type { AdminRole } from './adminRoles'
import type { AdminPrincipal, AdminRequestContext } from './adminTypes'

const TOTP_ISSUER = 'Corvale Admin'

export interface AdminIdentity {
    id: string
    email: string
    role: AdminRole
}

export interface AdminLoginResult {
    accessToken: string
    expiresInSeconds: number
    refreshToken: string
    sessionExpiresAt: Date
    stepUpUntil: Date | null
    admin: AdminIdentity
}

const identityOf = (admin: IAdminUser): AdminIdentity => ({ id: admin._id.toString(), email: admin.email, role: admin.role })

const invalidCredentials = (): CustomError => new CustomError(ERROR_MESSAGES.ADMIN.INVALID_CREDENTIALS, 401)

const isMoneyBlocked = (admin: { moneyBlockedUntil: Date | null }, now: Date): boolean =>
    admin.moneyBlockedUntil !== null && admin.moneyBlockedUntil > now

const decryptSecret = (sealed: string | null): string | null => {
    if (!sealed) return null
    try {
        return openSecret(sealed, getAdminTotpKey())
    } catch {
        return null
    }
}

/** One TOTP step is single-use: the counter is advanced atomically so two concurrent requests cannot both spend it. */
const spendTotp = async (admin: IAdminUser, secret: string, token: unknown, now: Date): Promise<boolean> => {
    const verification = verifyTotp(secret, token, { timestampMs: now.getTime() })
    if (!verification.valid) return false

    const claimed = await AdminUser.updateOne(
        { _id: admin._id, $or: [{ totpLastStep: null }, { totpLastStep: { $lt: verification.step } }] },
        { $set: { totpLastStep: verification.step } }
    )
    return claimed.modifiedCount === 1
}

const spendRecoveryCode = async (admin: IAdminUser, code: unknown): Promise<boolean> => {
    if (typeof code !== 'string' || code.trim() === '') return false

    const hash = sha256Hex(normalizeRecoveryCode(code))
    const consumed = await AdminUser.updateOne({ _id: admin._id, recoveryCodeHashes: hash }, { $pull: { recoveryCodeHashes: hash } })
    return consumed.modifiedCount === 1
}

/**
 * Counts a failed second factor (at login or step-up) and locks the account on the fifth. Locking also ends
 * every live session, so a stolen access token cannot keep guessing codes.
 */
const registerFailure = async (
    admin: IAdminUser,
    kind: 'admin.login_failed' | 'admin.stepup_failed',
    ctx: AdminRequestContext,
    now: Date
): Promise<void> => {
    const updated = await AdminUser.findOneAndUpdate({ _id: admin._id }, { $inc: { failedLoginCount: 1 } }, { new: true })

    await recordAudit({ adminId: admin._id, adminRole: admin.role, action: kind, ip: ctx.ip, requestId: ctx.requestId, at: now })

    if (updated && updated.failedLoginCount >= getMaxFailedLogins()) {
        await AdminUser.updateOne({ _id: admin._id }, { $set: { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + getLockoutMs()) } })
        await revokeAdminSessions(admin._id.toString(), now)
        await recordAudit({ adminId: admin._id, adminRole: admin.role, action: 'admin.lockout', ip: ctx.ip, requestId: ctx.requestId, at: now })
    }
}

interface LoginInput {
    email?: unknown
    password?: unknown
    totpCode?: unknown
    recoveryCode?: unknown
}

export const loginAdmin = async (input: LoginInput, ctx: AdminRequestContext, now: Date = new Date()): Promise<AdminLoginResult> => {
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
    const admin = email ? await AdminUser.findOne({ email }) : null
    const usable = admin !== null && admin.status === 'active'

    if (usable && admin.lockedUntil && admin.lockedUntil > now) {
        throw new CustomError(ERROR_MESSAGES.ADMIN.LOCKED, 429)
    }

    const passwordOk = await verifyAdminPassword(typeof input.password === 'string' ? input.password : '', usable ? admin.passwordHash : null)

    let usedTotp = false
    let secondFactorOk = false
    if (usable && passwordOk) {
        const secret = decryptSecret(admin.totpSecretEnc)
        if (typeof input.totpCode === 'string' && input.totpCode !== '') {
            secondFactorOk = secret !== null && (await spendTotp(admin, secret, input.totpCode, now))
            usedTotp = secondFactorOk
        } else {
            secondFactorOk = await spendRecoveryCode(admin, input.recoveryCode)
        }
    }

    if (!usable || !passwordOk || !secondFactorOk) {
        if (usable) {
            await registerFailure(admin, 'admin.login_failed', ctx, now)
        } else {
            await recordAudit({ action: 'admin.login_failed', ip: ctx.ip, requestId: ctx.requestId, at: now })
        }
        throw invalidCredentials()
    }

    await AdminUser.updateOne({ _id: admin._id }, { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } })

    const stepUp = usedTotp && !isMoneyBlocked(admin, now)
    const session = await createAdminSession(admin._id.toString(), ctx.ip, now, { stepUp })
    await recordAudit({ adminId: admin._id, adminRole: admin.role, action: 'admin.login', ip: ctx.ip, requestId: ctx.requestId, at: now })

    return {
        accessToken: signAdminAccessToken(admin._id.toString(), session.sessionId, admin.role),
        expiresInSeconds: getAccessTokenTtlSeconds(),
        refreshToken: session.refreshToken,
        sessionExpiresAt: session.expiresAt,
        stepUpUntil: session.stepUpAt ? new Date(session.stepUpAt.getTime() + getStepUpWindowMs()) : null,
        admin: identityOf(admin),
    }
}

export interface AdminRefreshResult {
    accessToken: string
    expiresInSeconds: number
    refreshToken: string
    sessionExpiresAt: Date
    admin: AdminIdentity
}

export const refreshAdminAccess = async (presented: string | null, ctx: AdminRequestContext, now: Date = new Date()): Promise<AdminRefreshResult> => {
    if (!presented) throw new CustomError(ERROR_MESSAGES.ADMIN.TOKEN_INVALID, 401)

    const rotated = await rotateAdminSession(presented, now)
    if ('reuseDetectedFor' in rotated) {
        await recordAudit({ adminId: rotated.reuseDetectedFor, action: 'admin.session_revoked', ip: ctx.ip, requestId: ctx.requestId, at: now })
        throw new CustomError(ERROR_MESSAGES.ADMIN.TOKEN_INVALID, 401)
    }

    return {
        accessToken: signAdminAccessToken(rotated.adminId, rotated.sessionId, rotated.role),
        expiresInSeconds: getAccessTokenTtlSeconds(),
        refreshToken: rotated.refreshToken,
        sessionExpiresAt: rotated.expiresAt,
        admin: { id: rotated.adminId, email: rotated.email, role: rotated.role },
    }
}

/** Never throws for a bad credential: signing out with nothing valid is simply a no-op. */
export const logoutAdmin = async (input: { refreshToken: string | null; accessToken: string | null }, now: Date = new Date()): Promise<void> => {
    if (input.refreshToken) await revokeSessionByRefreshToken(input.refreshToken, now)

    if (input.accessToken) {
        try {
            await revokeSessionById(verifyAdminAccessToken(input.accessToken).sid, now)
        } catch {
            // an expired or foreign token has nothing to revoke
        }
    }
}

export const stepUpAdmin = async (
    principal: AdminPrincipal,
    totpCode: unknown,
    ctx: AdminRequestContext,
    now: Date = new Date()
): Promise<{ stepUpUntil: Date }> => {
    if (principal.moneyBlockedUntil && principal.moneyBlockedUntil > now) {
        throw new CustomError(ERROR_MESSAGES.ADMIN.STEP_UP_DISABLED, 403)
    }

    const admin = await AdminUser.findById(principal.id)
    if (!admin || admin.status !== 'active') throw new CustomError(ERROR_MESSAGES.ADMIN.TOKEN_INVALID, 401)

    const secret = decryptSecret(admin.totpSecretEnc)
    if (!secret || !(await spendTotp(admin, secret, totpCode, now))) {
        await registerFailure(admin, 'admin.stepup_failed', ctx, now)
        throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_TOTP, 401)
    }

    await markStepUp(principal.sessionId, now)
    return { stepUpUntil: new Date(now.getTime() + getStepUpWindowMs()) }
}

export interface AdminMe {
    admin: AdminIdentity
    session: { expiresAt: Date; idleExpiresAt: Date; stepUpUntil: Date | null }
    moneyBlockedUntil: Date | null
}

export const describeSession = (principal: AdminPrincipal, now: Date = new Date()): AdminMe => {
    const stepUpUntil = principal.stepUpAt ? new Date(principal.stepUpAt.getTime() + getStepUpWindowMs()) : null
    return {
        admin: { id: principal.id, email: principal.email, role: principal.role },
        session: {
            expiresAt: principal.sessionExpiresAt,
            idleExpiresAt: principal.idleExpiresAt,
            stepUpUntil: stepUpUntil && stepUpUntil > now ? stepUpUntil : null,
        },
        moneyBlockedUntil: principal.moneyBlockedUntil && principal.moneyBlockedUntil > now ? principal.moneyBlockedUntil : null,
    }
}

const MAX_ENROLMENT_ATTEMPTS = 5

const findEnrolmentTarget = async (token: unknown, now: Date): Promise<IAdminUser> => {
    if (typeof token !== 'string' || token.length < 20) throw new CustomError(ERROR_MESSAGES.ADMIN.ENROLMENT_INVALID, 400)

    const admin = await AdminUser.findOne({
        enrolmentTokenHash: sha256Hex(token),
        enrolmentExpiresAt: { $gt: now },
        status: { $in: ['pending', 'reenrol'] },
    })
    if (!admin) throw new CustomError(ERROR_MESSAGES.ADMIN.ENROLMENT_INVALID, 400)
    return admin
}

export interface EnrolmentStart {
    email: string
    role: AdminRole
    secret: string
    otpauthUri: string
    requiresPassword: boolean
}

export const startEnrolment = async (token: unknown, now: Date = new Date()): Promise<EnrolmentStart> => {
    const admin = await findEnrolmentTarget(token, now)
    const key = getAdminTotpKey()

    let secret = admin.pendingTotpSecretEnc ? decryptSecret(admin.pendingTotpSecretEnc) : null
    if (!secret) {
        secret = generateTotpSecret()
        await AdminUser.updateOne({ _id: admin._id }, { $set: { pendingTotpSecretEnc: sealSecret(secret, key) } })
    }

    return {
        email: admin.email,
        role: admin.role,
        secret,
        otpauthUri: buildOtpauthUri({ secret, label: admin.email, issuer: TOTP_ISSUER }),
        requiresPassword: admin.status === 'pending',
    }
}

const noteEnrolmentFailure = async (admin: IAdminUser, ctx: AdminRequestContext, now: Date): Promise<void> => {
    const updated = await AdminUser.findOneAndUpdate({ _id: admin._id }, { $inc: { failedLoginCount: 1 } }, { new: true })
    if (updated && updated.failedLoginCount >= MAX_ENROLMENT_ATTEMPTS) {
        await AdminUser.updateOne({ _id: admin._id }, { $set: { enrolmentTokenHash: null, enrolmentExpiresAt: null, failedLoginCount: 0 } })
        await recordAudit({ adminId: admin._id, adminRole: admin.role, action: 'admin.lockout', ip: ctx.ip, requestId: ctx.requestId, at: now })
    }
}

/**
 * Finishes enrolment: a first-time admin chooses a password; a re-enrolling one must prove the existing
 * password instead, so whoever holds the token can never take the account over by picking a new one.
 * Success burns the token and returns the recovery codes - the only time they exist in the clear.
 */
export const completeEnrolment = async (
    input: { token?: unknown; password?: unknown; totpCode?: unknown },
    ctx: AdminRequestContext,
    now: Date = new Date()
): Promise<{ recoveryCodes: string[] }> => {
    const admin = await findEnrolmentTarget(input.token, now)
    const reenrolling = admin.status === 'reenrol'

    let passwordHash: string | null = null
    if (reenrolling) {
        const ok = typeof input.password === 'string' && (await verifyAdminPassword(input.password, admin.passwordHash))
        if (!ok) {
            await noteEnrolmentFailure(admin, ctx, now)
            throw new CustomError(ERROR_MESSAGES.ADMIN.PASSWORD_INVALID, 400)
        }
    } else {
        passwordHash = await hashAdminPassword(validateAdminPassword(input.password))
    }

    const secret = decryptSecret(admin.pendingTotpSecretEnc)
    const verification = secret ? verifyTotp(secret, input.totpCode, { timestampMs: now.getTime() }) : { valid: false as const }
    if (!secret || !verification.valid) {
        await noteEnrolmentFailure(admin, ctx, now)
        throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_TOTP, 400)
    }

    const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT)
    const set: Record<string, unknown> = {
        status: 'active',
        totpSecretEnc: admin.pendingTotpSecretEnc,
        pendingTotpSecretEnc: null,
        totpLastStep: verification.step,
        recoveryCodeHashes: recoveryCodes.map((code) => sha256Hex(normalizeRecoveryCode(code))),
        enrolmentTokenHash: null,
        enrolmentExpiresAt: null,
        failedLoginCount: 0,
        lockedUntil: null,
        moneyBlockedUntil: reenrolling ? new Date(now.getTime() + REENROL_MONEY_BLOCK_MS) : null,
    }
    if (passwordHash) set.passwordHash = passwordHash

    const claimed = await AdminUser.updateOne(
        { _id: admin._id, enrolmentTokenHash: admin.enrolmentTokenHash, status: admin.status },
        { $set: set }
    )
    if (claimed.modifiedCount !== 1) throw new CustomError(ERROR_MESSAGES.ADMIN.ENROLMENT_INVALID, 400)

    await recordAudit({ adminId: admin._id, adminRole: admin.role, action: 'admin.enrolled', ip: ctx.ip, requestId: ctx.requestId, at: now })
    return { recoveryCodes }
}
