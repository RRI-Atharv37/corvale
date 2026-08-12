import crypto from 'crypto'
import jwt, { SignOptions } from 'jsonwebtoken'
import { Response } from 'express'
import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'

export interface AccessTokenPayload {
    id: string
    tv: number
}

const REFRESH_TOKEN_COOKIE = process.env.REFRESH_TOKEN_COOKIE_NAME ?? 'spndr_refresh'
const REFRESH_COOKIE_PATH = '/api/v1/auth'

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
        sameSite: 'lax',
        maxAge: getRefreshTokenMaxAgeMs(),
        path: REFRESH_COOKIE_PATH,
    })
}

export const clearRefreshTokenCookie = (res: Response): void => {
    res.clearCookie(REFRESH_TOKEN_COOKIE, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: REFRESH_COOKIE_PATH,
    })
}

export const getRefreshTokenFromRequest = (cookies: Record<string, string | undefined>): string | null => {
    const token = cookies[REFRESH_TOKEN_COOKIE]
    return token ?? null
}
