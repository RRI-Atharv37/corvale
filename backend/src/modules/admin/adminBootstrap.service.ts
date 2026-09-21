import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { generateOpaqueToken, sha256Hex, timingSafeEqualStrings } from '@core/auth/tokenHash'
import { isDuplicateKeyError } from '@core/db/objectId'
import { EMAIL_REGEX } from '@infra/mail/emailUtils'
import { sendAdminSecurityNotice } from '@infra/mail/mailService'
import { logger } from '@infra/observability/logger'

import { recordAudit } from './adminAudit.service'
import {
    ENROLMENT_TOKEN_TTL_MS,
    MIN_RECOVERY_SECRET_LENGTH,
    getBootstrapSecretHash,
    getBreakGlassSecretHash,
} from './adminConfig'
import { revokeAdminSessions } from './adminSession.service'
import AdminSystem from './adminSystem.model'
import AdminUser, { type IAdminUser } from './adminUser.model'

export interface EnrolmentGrant {
    adminId: string
    enrolmentToken: string
    expiresAt: Date
}

const secretMatches = (supplied: string, configuredHash: string | null): boolean =>
    configuredHash !== null &&
    supplied.length >= MIN_RECOVERY_SECRET_LENGTH &&
    timingSafeEqualStrings(sha256Hex(supplied), configuredHash)

/** Issues a single-use enrolment token; only its hash is stored. */
export const issueEnrolmentToken = (ttlMs: number, now: Date): { token: string; hash: string; expiresAt: Date } => {
    const token = generateOpaqueToken()
    return { token, hash: sha256Hex(token), expiresAt: new Date(now.getTime() + ttlMs) }
}

/**
 * First owner only. It refuses while any admin exists or once it has ever been used, needs a secret that
 * matches the configured hash, and creates a `pending` owner with no password and no factor: nothing can
 * sign in until the owner completes enrolment in the admin app with the token printed here.
 */
export const createBootstrapOwner = async (input: { email: string; secret: string; now?: Date }): Promise<EnrolmentGrant> => {
    const now = input.now ?? new Date()
    const email = input.email.trim().toLowerCase()
    if (!EMAIL_REGEX.test(email)) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_EMAIL, 400)

    if (!secretMatches(input.secret, getBootstrapSecretHash())) {
        throw new CustomError(ERROR_MESSAGES.ADMIN.BOOTSTRAP_SECRET_INVALID, 403)
    }
    if (await AdminUser.exists({})) {
        throw new CustomError(ERROR_MESSAGES.ADMIN.BOOTSTRAP_ALREADY_DONE, 409)
    }

    try {
        await AdminSystem.updateOne({ key: 'system', bootstrapConsumedAt: null }, { $set: { bootstrapConsumedAt: now } }, { upsert: true })
    } catch (error) {
        if (isDuplicateKeyError(error)) throw new CustomError(ERROR_MESSAGES.ADMIN.BOOTSTRAP_ALREADY_DONE, 409)
        throw error
    }

    const token = issueEnrolmentToken(ENROLMENT_TOKEN_TTL_MS, now)
    try {
        const owner = await AdminUser.create({
            email,
            role: 'owner',
            status: 'pending',
            enrolmentTokenHash: token.hash,
            enrolmentExpiresAt: token.expiresAt,
        })

        await recordAudit({ actorType: 'system', action: 'admin.bootstrap', targetAdminId: owner._id, at: now })
        return { adminId: owner._id.toString(), enrolmentToken: token.token, expiresAt: token.expiresAt }
    } catch (error) {
        await AdminSystem.updateOne({ key: 'system' }, { $set: { bootstrapConsumedAt: null } })
        throw error
    }
}

/**
 * Puts an admin into `reenrol`: their factor and recovery codes are gone, every session is ended, and the
 * only way back in is a fresh single-use enrolment token that also demands their existing password.
 */
export const beginReenrolment = async (adminId: string, now: Date): Promise<EnrolmentGrant> => {
    const token = issueEnrolmentToken(ENROLMENT_TOKEN_TTL_MS, now)

    await AdminUser.updateOne(
        { _id: adminId },
        {
            $set: {
                status: 'reenrol',
                totpSecretEnc: null,
                pendingTotpSecretEnc: null,
                totpLastStep: null,
                recoveryCodeHashes: [],
                failedLoginCount: 0,
                lockedUntil: null,
                enrolmentTokenHash: token.hash,
                enrolmentExpiresAt: token.expiresAt,
            },
        }
    )
    await revokeAdminSessions(adminId, now)

    return { adminId, enrolmentToken: token.token, expiresAt: token.expiresAt }
}

export const countActiveOwners = (excludeAdminId?: string): Promise<number> =>
    AdminUser.countDocuments({ role: 'owner', status: 'active', ...(excludeAdminId ? { _id: { $ne: excludeAdminId } } : {}) })

/** Best effort: a mail outage must never block a recovery, so failures are logged and counted out. */
export const notifyAdminSecurityEvent = async (
    recipients: string[],
    event: 'totp_reset' | 'break_glass',
    now: Date
): Promise<number> => {
    let delivered = 0
    for (const address of new Set(recipients)) {
        try {
            await sendAdminSecurityNotice(address, { event, when: now })
            delivered += 1
        } catch (error) {
            logger.warn('Admin security notice could not be delivered', { event, message: error instanceof Error ? error.message : 'unknown' })
        }
    }
    return delivered
}

const activeOwnerEmails = async (excludeAdminId: string): Promise<string[]> => {
    const owners: Pick<IAdminUser, 'email'>[] = await AdminUser.find({ role: 'owner', status: 'active', _id: { $ne: excludeAdminId } })
        .select('email')
        .lean()
    return owners.map((owner) => owner.email)
}

/**
 * Lost authenticator AND recovery codes. Needs shell access plus its own secret, and deliberately does not
 * set a factor or issue a session: the admin must re-enrol with the printed token. The last active owner
 * can be reset only with an explicit confirmation, because refusing outright would strand a one-person team.
 */
export const breakGlass = async (input: {
    email: string
    secret: string
    confirmLastOwner?: boolean
    now?: Date
}): Promise<EnrolmentGrant & { notified: number }> => {
    const now = input.now ?? new Date()

    if (!secretMatches(input.secret, getBreakGlassSecretHash())) {
        throw new CustomError(ERROR_MESSAGES.ADMIN.BREAKGLASS_SECRET_INVALID, 403)
    }

    const target = await AdminUser.findOne({ email: input.email.trim().toLowerCase() })
    if (!target) throw new CustomError(ERROR_MESSAGES.ADMIN.ADMIN_NOT_FOUND, 404)

    const isLastActiveOwner =
        target.role === 'owner' && target.status === 'active' && (await countActiveOwners(target._id.toString())) === 0
    if (isLastActiveOwner && !input.confirmLastOwner) throw new CustomError(ERROR_MESSAGES.ADMIN.LAST_OWNER, 409)

    const grant = await beginReenrolment(target._id.toString(), now)
    await recordAudit({ actorType: 'system', action: 'admin.break_glass', targetAdminId: target._id, at: now })
    logger.warn('Admin break-glass used', { targetAdminId: target._id.toString(), lastOwner: isLastActiveOwner })

    const notified = await notifyAdminSecurityEvent([target.email, ...(await activeOwnerEmails(target._id.toString()))], 'break_glass', now)
    return { ...grant, notified }
}

/** A configured bootstrap hash that has already been used is a loose end worth a loud reminder at boot. */
export const warnIfBootstrapSecretLingering = async (): Promise<void> => {
    if (getBootstrapSecretHash() === null) return

    const system = await AdminSystem.findOne({ key: 'system' }).lean()
    if (system?.bootstrapConsumedAt) {
        logger.warn('ADMIN_BOOTSTRAP_SECRET_SHA256 is still set although bootstrap has been used; remove it from the environment')
    }
}
