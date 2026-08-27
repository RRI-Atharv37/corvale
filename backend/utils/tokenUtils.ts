import crypto from 'crypto'
import jwt, { SignOptions } from 'jsonwebtoken'
import { Response } from 'express'
import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'

export interface AccessTokenPayload {
    id: string
    tv: number
}

const REFRESH_TOKEN_COOKIE = process.env.REFRESH_TOKEN_COOKIE_NAME ?? 'corvale_refresh'
const REFRESH_COOKIE_PATH = '/api/v1/auth'

/**
 * V7.3a rename-compat shim: the refresh cookie's default name changed from `spndr_refresh` to
 * `corvale_refresh` with the Corvale rename. A rename alone never removes the old cookie, so a
 * pre-rename tester's browser would carry a dead `spndr_refresh` indefinitely. Every path that
 * clears the session (logout, logout-all, account deletion) also issues a one-shot expiry for
 * this legacy name. Safe to delete one release after v1.0.0. See ROADMAP's V7 compat matrix.
 */
const LEGACY_REFRESH_TOKEN_COOKIE = 'spndr_refresh'

const VALID_REFRESH_COOKIE_SAME_SITE = ['lax', 'strict', 'none'] as const
type RefreshCookieSameSite = (typeof VALID_REFRESH_COOKIE_SAME_SITE)[number]

/**
 * SEC-11: spndr's pinned deployment topology is same-site (frontend and API share a
 * registrable domain), so the refresh cookie defaults to `SameSite=Lax`. A cross-site
 * deployment must opt in explicitly via `REFRESH_COOKIE_SAME_SITE=none` — silently
 * switching topologies without changing this setting is exactly what caused SEC-11 (an
 * unnoticed 15-minute logout loop, since the cookie stopped being sent but no error
 * surfaced anywhere). `none` is only accepted when `NODE_ENV=production` because a
 * `SameSite=None` cookie without `Secure` is rejected outright by browsers, and `Secure`
 * below is only ever true in production — so a misconfigured `none` fails loudly at
 * startup instead of shipping a cookie that silently never arrives.
 */
export const getRefreshCookieSameSite = (env: NodeJS.ProcessEnv = process.env): RefreshCookieSameSite => {
    const raw = env.REFRESH_COOKIE_SAME_SITE ?? 'lax'
    if (!VALID_REFRESH_COOKIE_SAME_SITE.includes(raw as RefreshCookieSameSite)) {
        throw new Error(
            `Invalid REFRESH_COOKIE_SAME_SITE "${raw}": must be one of ${VALID_REFRESH_COOKIE_SAME_SITE.join(', ')}`
        )
    }
    if (raw === 'none' && env.NODE_ENV !== 'production') {
        throw new Error(
            'REFRESH_COOKIE_SAME_SITE=none requires NODE_ENV=production (a SameSite=None cookie must ' +
                'also be Secure, or browsers reject it outright)'
        )
    }
    return raw as RefreshCookieSameSite
}

export const hashToken = (token: string): string => {
    return crypto.createHash('sha256').update(token).digest('hex')
}

export const generateRefreshTokenValue = (): string => {
    return crypto.randomBytes(32).toString('hex')
}

export const generateAccessToken = (userId: string, tokenVersion: number): string => {
    if (!process.env.JWT_SECRET) {
        throw new CustomError(ERROR_MESSAGES.GENERAL.JWT_SECRET_MISSING, 500)
    }

    return jwt.sign({ id: userId, tv: tokenVersion }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRY as string,
    } as SignOptions)
}

export const getRefreshTokenMaxAgeMs = (): number => {
    const expiry = process.env.JWT_REFRESH_EXPIRY ?? '7d'
    return parseDurationToMs(expiry)
}

const parseDurationToMs = (duration: string): number => {
    const match = duration.match(/^(\d+)([smhd])$/)
    if (!match) {
        return 7 * 24 * 60 * 60 * 1000
    }

    const value = Number(match[1])
    const unit = match[2]

    switch (unit) {
        case 's':
            return value * 1000
        case 'm':
            return value * 60 * 1000
        case 'h':
            return value * 60 * 60 * 1000
        case 'd':
            return value * 24 * 60 * 60 * 1000
        default:
            return 7 * 24 * 60 * 60 * 1000
    }
}

export const setRefreshTokenCookie = (res: Response, refreshToken: string): void => {
    res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: getRefreshCookieSameSite(),
        maxAge: getRefreshTokenMaxAgeMs(),
        path: REFRESH_COOKIE_PATH,
    })
}

export const clearRefreshTokenCookie = (res: Response): void => {
    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: getRefreshCookieSameSite(),
        path: REFRESH_COOKIE_PATH,
    }
    res.clearCookie(REFRESH_TOKEN_COOKIE, options)
    // V7.3a: expire any pre-rename `spndr_refresh` cookie still sitting in the browser.
    if (LEGACY_REFRESH_TOKEN_COOKIE !== REFRESH_TOKEN_COOKIE) {
        res.clearCookie(LEGACY_REFRESH_TOKEN_COOKIE, options)
    }
}

export const getRefreshTokenFromRequest = (cookies: Record<string, string | undefined>): string | null => {
    const token = cookies[REFRESH_TOKEN_COOKIE]
    return token ?? null
}
