import crypto from 'crypto'
import jwt, { SignOptions } from 'jsonwebtoken'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

export interface AccessTokenPayload {
    id: string
    tv: number
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
