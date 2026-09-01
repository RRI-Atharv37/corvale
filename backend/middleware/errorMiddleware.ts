import { Request, Response, NextFunction } from 'express'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { logger } from '../utils/logger'
import { captureException } from '../utils/errorTracking'

export const errorHandler = (
    err: Error,
    req: Request,
    res: Response,
    _next: NextFunction
): void => {
    const isCustomError = err instanceof CustomError
    // SEC-60: a malformed ObjectId in a path param that reaches `Model.findById` throws a
    // Mongoose CastError — a client-input error, not a server fault. Treat it as a 400 so it
    // returns the standard error shape and never reaches Sentry as a false incident. The
    // shared lookup helpers pre-validate now; this is the backstop for every other call site.
    const isCastError = !isCustomError && (err as { name?: string }).name === 'CastError'
    // body-parser and other middleware (e.g. PayloadTooLargeError) throw plain
    // Errors carrying a real HTTP status via .statusCode/.status rather than a
    // CustomError; relay it instead of collapsing every non-CustomError to 500.
    const externalStatus = (err as { statusCode?: unknown; status?: unknown }).statusCode ??
        (err as { statusCode?: unknown; status?: unknown }).status
    const statusCode = isCustomError
        ? err.statusCode
        : isCastError
          ? 400
          : typeof externalStatus === 'number' && externalStatus >= 400 && externalStatus < 600
            ? externalStatus
            : 500
    const message = isCustomError
        ? err.message
        : isCastError
          ? ERROR_MESSAGES.GENERAL.INVALID_IDENTIFIER
          : 'Internal Server Error'

    logger.error(message, {
        statusCode,
        path: req.path,
        method: req.method,
        stack: isCustomError || isCastError ? undefined : err.stack,
    })

    // Only 5xx (unexpected/server-side) failures go to error tracking -- 4xx CustomErrors
    // (validation, auth, not-found) are expected client-facing responses, not incidents.
    if (statusCode >= 500) {
        captureException(err, { statusCode, path: req.path, method: req.method })
    }

    res.status(statusCode).json({
        success: false,
        statusCode,
        message,
        stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    })
}
