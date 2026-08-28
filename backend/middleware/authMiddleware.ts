import dotenv from 'dotenv'
dotenv.config()

import jwt from 'jsonwebtoken'
import { Response, NextFunction } from 'express'

import User, { IUser } from '../models/User'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { AuthRequest } from './authTypes'
import { runWithRlsContext } from '../utils/rowLevelSecurity'

export type { AuthRequest } from './authTypes'

/**
 * Resolves and validates the bearer token, returning the loaded user or throwing a
 * CustomError. Shared by `authenticateOnly` (auth only) and `protect` (auth + the
 * email-verification hard block), so both middlewares apply identical token/tokenVersion
 * checks instead of duplicating them.
 */
const authenticateRequest = async (req: AuthRequest): Promise<IUser> => {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new CustomError(ERROR_MESSAGES.AUTH.TOKEN_MISSING, 401)
    }

    const token = authHeader.split(' ')[1]

    if (!process.env.JWT_SECRET) {
        throw new CustomError(ERROR_MESSAGES.GENERAL.JWT_SECRET_MISSING, 500)
    }

    let decoded: { id: string; tv?: number }
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET) as { id: string; tv?: number }
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            throw new CustomError(ERROR_MESSAGES.AUTH.TOKEN_EXPIRED, 401)
        }
        throw new CustomError(ERROR_MESSAGES.AUTH.TOKEN_INVALID, 401)
    }

    const user = await User.findById(decoded.id).select('-password')
    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 401)
    }

    const tokenVersion = decoded.tv ?? 0
    if (tokenVersion !== user.tokenVersion) {
        throw new CustomError(ERROR_MESSAGES.AUTH.TOKEN_REVOKED, 401)
    }

    return user
}

/**
 * Authenticates the request only — no email-verification check. Reserved for the handful
 * of routes an unverified-but-logged-in user must still be able to reach (checking their own
 * profile, logging out, resending the verification email).
 */
export const authenticateOnly = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const user = await authenticateRequest(req)
        req.user = user
        return runWithRlsContext({ userId: user._id.toString() }, () => {
            next()
        })
    } catch (error) {
        return next(error)
    }
}

/**
 * Attaches `req.user` (and an RLS context) when a valid bearer token is present, but lets the
 * request through unauthenticated otherwise. A *present* but invalid/expired token is still an
 * error. Used by routes that serve both a signed-in and a signed-out caller — e.g. resending a
 * verification email, which a returning unverified user (blocked at login, so no token) must
 * still be able to trigger by email.
 */
export const optionalAuthenticate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next()
    }
    try {
        const user = await authenticateRequest(req)
        req.user = user
        return runWithRlsContext({ userId: user._id.toString() }, () => {
            next()
        })
    } catch (error) {
        return next(error)
    }
}

/**
 * Authenticates the request and hard-blocks unverified accounts. This is the middleware every
 * other router in the app imports, so the verification gate applies everywhere by default
 * without touching those route files individually.
 */
export const protect = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const user = await authenticateRequest(req)
        if (!user.isEmailVerified) {
            throw new CustomError(ERROR_MESSAGES.AUTH.EMAIL_NOT_VERIFIED, 403)
        }
        req.user = user
        return runWithRlsContext({ userId: user._id.toString() }, () => {
            next()
        })
    } catch (error) {
        return next(error)
    }
}
