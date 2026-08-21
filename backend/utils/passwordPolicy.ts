import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'

export const MIN_PASSWORD_LENGTH = 12
export const MAX_PASSWORD_BYTES = 72

/**
 * Type-checks before ever reading `.length` (BUG-14 — a non-empty array body
 * value passes a bare truthiness check and previously reached `.length`
 * unchecked), then enforces a floor and an explicit ceiling so bcrypt's
 * silent 72-byte truncation never happens without the caller knowing (SEC-22).
 */
export const validatePassword = (password: unknown): string => {
    if (typeof password !== 'string') {
        throw new CustomError(ERROR_MESSAGES.AUTH.INVALID_PASSWORD_TYPE, 400)
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
        throw new CustomError(ERROR_MESSAGES.AUTH.PASSWORD_TOO_SHORT, 400)
    }

    if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
        throw new CustomError(ERROR_MESSAGES.AUTH.PASSWORD_TOO_LONG, 400)
    }

    return password
}
