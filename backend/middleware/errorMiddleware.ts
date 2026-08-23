import { Request, Response, NextFunction } from 'express'
import { CustomError } from '../utils/customError'
import { logger } from '../utils/logger'
import { captureException } from '../utils/errorTracking'

export const errorHandler = (
    err: Error,
    req: Request,
    res: Response,
    _next: NextFunction
): void => {
    const isCustomError = err instanceof CustomError
    // body-parser and other middleware (e.g. PayloadTooLargeError) throw plain
    // Errors carrying a real HTTP status via .statusCode/.status rather than a
    // CustomError; relay it instead of collapsing every non-CustomError to 500.
    const externalStatus = (err as { statusCode?: unknown; status?: unknown }).statusCode ??
        (err as { statusCode?: unknown; status?: unknown }).status
    const statusCode = isCustomError
        ? err.statusCode
        : typeof externalStatus === 'number' && externalStatus >= 400 && externalStatus < 600
          ? externalStatus
          : 500
    const message = isCustomError ? err.message : 'Internal Server Error'

    logger.error(message, {
        statusCode,
        path: req.path,
        method: req.method,
        stack: isCustomError ? undefined : err.stack,
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
