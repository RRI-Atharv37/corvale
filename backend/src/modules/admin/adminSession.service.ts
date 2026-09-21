import jwt from 'jsonwebtoken'
import { Types } from 'mongoose'

import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { generateOpaqueToken, sha256Hex } from '@core/auth/tokenHash'

import {
    ADMIN_TOKEN_AUDIENCE,
    ADMIN_TOKEN_ISSUER,
    getAccessTokenTtlSeconds,
    getAdminJwtSecret,
    getSessionAbsoluteMs,
    getSessionIdleMs,
} from './adminConfig'
import AdminSession from './adminSession.model'
import AdminUser from './adminUser.model'
import type { AdminRole } from './adminRoles'
import type { AdminPrincipal } from './adminTypes'

const ACTIVITY_TOUCH_INTERVAL_MS = 60 * 1000
const SESSION_ROW_GRACE_MS = 24 * 60 * 60 * 1000

const invalidToken = (): CustomError => new CustomError(ERROR_MESSAGES.ADMIN.TOKEN_INVALID, 401)

export const signAdminAccessToken = (adminId: string, sessionId: string, role: AdminRole): string =>
    jwt.sign({ sid: sessionId, role }, getAdminJwtSecret(), {
        algorithm: 'HS256',
        audience: ADMIN_TOKEN_AUDIENCE,
        issuer: ADMIN_TOKEN_ISSUER,
        subject: adminId,
        expiresIn: getAccessTokenTtlSeconds(),
    })

interface AccessTokenPayload {
    sub: string
    sid: string
}

/** Pinned algorithm, audience and issuer: a user token (a different secret and audience) never verifies here. */
export const verifyAdminAccessToken = (token: string): AccessTokenPayload => {
    try {
        const decoded = jwt.verify(token, getAdminJwtSecret(), {
            algorithms: ['HS256'],
            audience: ADMIN_TOKEN_AUDIENCE,
            issuer: ADMIN_TOKEN_ISSUER,
        }) as Partial<AccessTokenPayload>
        if (typeof decoded.sub !== 'string' || typeof decoded.sid !== 'string' || !Types.ObjectId.isValid(decoded.sid)) {
            throw invalidToken()
        }
        return { sub: decoded.sub, sid: decoded.sid }
    } catch {
        throw invalidToken()
    }
}

export interface CreatedSession {
    sessionId: string
    refreshToken: string
    expiresAt: Date
    stepUpAt: Date | null
}

export const createAdminSession = async (
    adminId: string,
    ip: string | null,
    now: Date,
    options: { stepUp: boolean }
): Promise<CreatedSession> => {
    const refreshToken = generateOpaqueToken()
    const expiresAt = new Date(now.getTime() + getSessionAbsoluteMs())
    const stepUpAt = options.stepUp ? now : null

    const session = await AdminSession.create({
        adminId,
        refreshHash: sha256Hex(refreshToken),
        lastActivityAt: now,
        absoluteExpiresAt: expiresAt,
        stepUpAt,
        ip,
        expireAt: new Date(expiresAt.getTime() + SESSION_ROW_GRACE_MS),
    })

    return { sessionId: session._id.toString(), refreshToken, expiresAt, stepUpAt }
}

export const revokeAdminSessions = async (adminId: string, now: Date = new Date()): Promise<number> => {
    const result = await AdminSession.updateMany({ adminId, revokedAt: null }, { $set: { revokedAt: now } })
    return result.modifiedCount
}

/**
 * The server-side half of authentication: the token proves who, the session row decides whether it is
 * still allowed. Revocation, the idle limit, the absolute limit and a disabled account all take effect on
 * the very next request.
 */
export const authenticateAdminToken = async (token: string, now: Date = new Date()): Promise<AdminPrincipal> => {
    const { sub, sid } = verifyAdminAccessToken(token)

    const session = await AdminSession.findById(sid)
    if (!session || session.revokedAt || session.adminId.toString() !== sub) throw invalidToken()

    const idleExpiresAt = new Date(session.lastActivityAt.getTime() + getSessionIdleMs())
    if (session.absoluteExpiresAt <= now || idleExpiresAt <= now) throw invalidToken()

    const admin = await AdminUser.findById(sub)
    if (!admin || admin.status !== 'active') throw invalidToken()

    let effectiveIdleExpiry = idleExpiresAt
    if (now.getTime() - session.lastActivityAt.getTime() > ACTIVITY_TOUCH_INTERVAL_MS) {
        await AdminSession.updateOne({ _id: session._id, revokedAt: null }, { $set: { lastActivityAt: now } })
        effectiveIdleExpiry = new Date(now.getTime() + getSessionIdleMs())
    }

    return {
        id: admin._id.toString(),
        email: admin.email,
        role: admin.role,
        sessionId: session._id.toString(),
        stepUpAt: session.stepUpAt,
        moneyBlockedUntil: admin.moneyBlockedUntil,
        sessionExpiresAt: session.absoluteExpiresAt,
        idleExpiresAt: effectiveIdleExpiry,
    }
}

export interface RotatedSession {
    adminId: string
    role: AdminRole
    email: string
    sessionId: string
    refreshToken: string
    expiresAt: Date
}

/**
 * Rotates the refresh token. Presenting the one it replaced means it leaked (or a client raced itself):
 * the whole session is revoked rather than guessing which holder is the real one.
 */
export const rotateAdminSession = async (
    presented: string,
    now: Date = new Date()
): Promise<RotatedSession | { reuseDetectedFor: string }> => {
    const hash = sha256Hex(presented)
    const session = await AdminSession.findOne({ refreshHash: hash })

    if (!session) {
        const replayed = await AdminSession.findOne({ previousRefreshHash: hash })
        if (replayed && !replayed.revokedAt) {
            await AdminSession.updateOne({ _id: replayed._id }, { $set: { revokedAt: now } })
            return { reuseDetectedFor: replayed.adminId.toString() }
        }
        throw invalidToken()
    }

    const idleExpiresAt = session.lastActivityAt.getTime() + getSessionIdleMs()
    if (session.revokedAt || session.absoluteExpiresAt <= now || idleExpiresAt <= now.getTime()) throw invalidToken()

    const admin = await AdminUser.findById(session.adminId)
    if (!admin || admin.status !== 'active') throw invalidToken()

    const refreshToken = generateOpaqueToken()
    const rotated = await AdminSession.updateOne(
        { _id: session._id, refreshHash: hash, revokedAt: null },
        { $set: { previousRefreshHash: hash, refreshHash: sha256Hex(refreshToken), lastActivityAt: now } }
    )
    if (rotated.modifiedCount !== 1) throw invalidToken()

    return {
        adminId: admin._id.toString(),
        role: admin.role,
        email: admin.email,
        sessionId: session._id.toString(),
        refreshToken,
        expiresAt: session.absoluteExpiresAt,
    }
}

export const revokeSessionByRefreshToken = async (presented: string, now: Date = new Date()): Promise<boolean> => {
    const hash = sha256Hex(presented)
    const result = await AdminSession.updateOne(
        { $or: [{ refreshHash: hash }, { previousRefreshHash: hash }], revokedAt: null },
        { $set: { revokedAt: now } }
    )
    return result.modifiedCount === 1
}

export const revokeSessionById = async (sessionId: string, now: Date = new Date()): Promise<void> => {
    await AdminSession.updateOne({ _id: sessionId, revokedAt: null }, { $set: { revokedAt: now } })
}

export const markStepUp = async (sessionId: string, now: Date): Promise<void> => {
    await AdminSession.updateOne({ _id: sessionId, revokedAt: null }, { $set: { stepUpAt: now } })
}
