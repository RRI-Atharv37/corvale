import { Request, Response, NextFunction } from 'express'

import { AuthRequest } from '@http/middleware/authTypes'
import { logger } from '@infra/observability/logger'

const UNLOGGED_PATHS = new Set(['/health', '/ready'])

/**
 * Structured access log: one `logger.info` line per completed request. Skips /health and
 * /ready so uptime-monitor polling doesn't drown the real log stream. `req.user` is read at
 * `finish` time, after downstream auth middleware has had a chance to set it, so authenticated
 * requests are attributed even though this middleware is mounted before routing.
 */
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
    if (UNLOGGED_PATHS.has(req.path)) {
        next()
        return
    }

    const start = Date.now()
    res.on('finish', () => {
        logger.info('request completed', {
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            durationMs: Date.now() - start,
            userId: (req as AuthRequest).user?._id?.toString(),
        })
    })
    next()
}
