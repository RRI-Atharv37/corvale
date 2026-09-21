import type { NextFunction, Request, RequestHandler, Response } from 'express'

import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

import { getIpAllowlist, getStepUpWindowMs, normaliseIp } from './adminConfig'
import { roleCan, type AdminCapability } from './adminRoles'
import { authenticateAdminToken } from './adminSession.service'
import type { AdminPrincipal, AdminRequestContext } from './adminTypes'

export interface AdminRequest extends Request {
    admin?: AdminPrincipal
}

/**
 * Outside `ADMIN_IP_ALLOWLIST` the whole admin surface answers 404, the same as when it is not mounted,
 * so a scanner learns nothing about it.
 */
export const adminIpAllowlist: RequestHandler = (req, res, next) => {
    const allowlist = getIpAllowlist()
    if (allowlist !== null && !allowlist.includes(normaliseIp(req.ip))) {
        res.status(404).json({ success: false, statusCode: 404, message: ERROR_MESSAGES.GENERAL.ROUTE_NOT_FOUND })
        return
    }
    next()
}

/** Bearer token verified against the admin secret and audience, then the live session. User tokens never pass. */
export const protectAdmin = async (req: AdminRequest, _res: Response, next: NextFunction): Promise<void> => {
    try {
        const header = req.headers.authorization
        if (!header || !header.startsWith('Bearer ')) throw new CustomError(ERROR_MESSAGES.ADMIN.TOKEN_MISSING, 401)

        req.admin = await authenticateAdminToken(header.slice('Bearer '.length))
        next()
    } catch (error) {
        next(error)
    }
}

export const requireCapability =
    (capability: AdminCapability): RequestHandler =>
    (req: AdminRequest, _res, next) => {
        if (!req.admin) return next(new CustomError(ERROR_MESSAGES.ADMIN.TOKEN_MISSING, 401))
        if (!roleCan(req.admin.role, capability)) return next(new CustomError(ERROR_MESSAGES.ADMIN.FORBIDDEN, 403))
        next()
    }

/**
 * For money and permanent actions: a TOTP re-check inside the step-up window, and never within 24 hours of an
 * authenticator reset (so a takeover through a reset cannot act on money straight away).
 */
export const requireStepUp: RequestHandler = (req: AdminRequest, _res, next) => {
    const admin = req.admin
    if (!admin) return next(new CustomError(ERROR_MESSAGES.ADMIN.TOKEN_MISSING, 401))

    const now = Date.now()
    if (admin.moneyBlockedUntil && admin.moneyBlockedUntil.getTime() > now) {
        return next(new CustomError(ERROR_MESSAGES.ADMIN.STEP_UP_DISABLED, 403))
    }
    if (!admin.stepUpAt || now - admin.stepUpAt.getTime() > getStepUpWindowMs()) {
        return next(new CustomError(ERROR_MESSAGES.ADMIN.STEP_UP_REQUIRED, 403))
    }
    next()
}

export const requestContext = (req: Request): AdminRequestContext => ({
    ip: req.ip ?? null,
    requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'].slice(0, 100) : null,
})
