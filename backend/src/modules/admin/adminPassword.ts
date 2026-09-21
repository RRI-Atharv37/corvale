import bcrypt from 'bcryptjs'

import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

import { MAX_ADMIN_PASSWORD_BYTES, MIN_ADMIN_PASSWORD_LENGTH, getBcryptRounds } from './adminConfig'

export const validateAdminPassword = (password: unknown): string => {
    if (typeof password !== 'string' || password.length < MIN_ADMIN_PASSWORD_LENGTH) {
        throw new CustomError(ERROR_MESSAGES.ADMIN.PASSWORD_TOO_SHORT, 400)
    }
    if (Buffer.byteLength(password, 'utf8') > MAX_ADMIN_PASSWORD_BYTES) {
        throw new CustomError(ERROR_MESSAGES.ADMIN.PASSWORD_TOO_LONG, 400)
    }
    return password
}

export const hashAdminPassword = (password: string): Promise<string> => bcrypt.hash(password, getBcryptRounds())

let dummyHash: Promise<string> | null = null

/**
 * With no stored hash it still spends a full bcrypt comparison, so a wrong email costs the same as a wrong
 * password and the response time does not reveal which admin addresses exist.
 */
export const verifyAdminPassword = async (password: string, hash: string | null): Promise<boolean> => {
    if (hash) return bcrypt.compare(password, hash).catch(() => false)

    dummyHash ??= bcrypt.hash('not-a-real-admin-password', getBcryptRounds())
    await bcrypt.compare(password, await dummyHash)
    return false
}
