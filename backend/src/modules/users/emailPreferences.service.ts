import crypto from 'crypto'

import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

import User from './user.model'

const PURPOSE = 'marketing-unsubscribe'
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/

const sign = (userId: string): string => {
    if (!process.env.JWT_SECRET) throw new CustomError(ERROR_MESSAGES.GENERAL.JWT_SECRET_MISSING, 500)

    return crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${PURPOSE}:${userId}`).digest('base64url')
}

/**
 * A stateless, non-expiring token: an unsubscribe link has to keep working for as long as the email
 * sits in an inbox, and nothing here can be used for anything but opting that one user out.
 */
export const buildUnsubscribeToken = (userId: string): string => `${userId}.${sign(userId)}`

export const buildUnsubscribeUrl = (userId: string): string =>
    `${process.env.CLIENT_URL ?? 'http://localhost:5173'}/unsubscribe?token=${buildUnsubscribeToken(userId)}`

const parseUnsubscribeToken = (token: unknown): string => {
    const invalid = new CustomError(ERROR_MESSAGES.USER.UNSUBSCRIBE_INVALID, 400)
    if (typeof token !== 'string') throw invalid

    const [userId, signature, ...rest] = token.split('.')
    if (!userId || !signature || rest.length > 0 || !OBJECT_ID_PATTERN.test(userId)) throw invalid

    const expected = Buffer.from(sign(userId))
    const actual = Buffer.from(signature)
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) throw invalid

    return userId
}

/** Idempotent, and silent about whether the account still exists. */
export const unsubscribeFromMarketing = async (token: unknown): Promise<void> => {
    const userId = parseUnsubscribeToken(token)

    await User.updateOne({ _id: userId }, { $set: { 'emailPreferences.marketing': false } })
}
