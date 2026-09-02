import { Request, Response, NextFunction } from 'express'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

const hasOperatorKey = (value: unknown): boolean => {
    if (Array.isArray(value)) {
        return value.some(hasOperatorKey)
    }

    if (value !== null && typeof value === 'object') {
        return Object.entries(value as Record<string, unknown>).some(
            ([key, nested]) => key.startsWith('$') || key.includes('.') || hasOperatorKey(nested)
        )
    }

    return false
}

/**
 * Rejects (rather than silently stripping) any request body containing a key
 * that starts with `$` or contains `.`, at any depth. Bodies flow straight into
 * Mongoose filters at several call sites (SEC-09); this is a project-wide guard
 * so every future controller inherits the protection.
 */
export const sanitizeBody = (req: Request, _res: Response, next: NextFunction): void => {
    if (hasOperatorKey(req.body)) {
        throw new CustomError(ERROR_MESSAGES.GENERAL.UNSAFE_REQUEST_BODY, 400)
    }
    next()
}
