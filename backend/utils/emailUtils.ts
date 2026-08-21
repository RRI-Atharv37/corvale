import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Type-checks, trims, and lowercases an incoming email before it is used in a
 * Mongoose filter or persisted, so casing/whitespace variants of the same
 * address collide (BUG-08) and a non-string body value is rejected outright
 * rather than reaching `User.findOne` (SEC-09).
 */
export const normalizeEmail = (email: unknown): string => {
    if (typeof email !== 'string') {
        throw new CustomError(ERROR_MESSAGES.AUTH.INVALID_EMAIL, 400)
    }

    const normalized = email.trim().toLowerCase()
    if (!EMAIL_REGEX.test(normalized)) {
        throw new CustomError(ERROR_MESSAGES.AUTH.INVALID_EMAIL, 400)
    }

    return normalized
}
