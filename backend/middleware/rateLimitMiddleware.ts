import rateLimit from 'express-rate-limit'
import { ERROR_MESSAGES } from '../utils/errorMessages'

export const createAuthRateLimiter = () =>
    rateLimit({
        windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
        max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 10,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res) => {
            res.status(429).json({
                success: false,
                statusCode: 429,
                message: ERROR_MESSAGES.AUTH.TOO_MANY_REQUESTS,
            })
        },
    })

export const createSyncPushRateLimiter = () =>
    rateLimit({
        windowMs: Number(process.env.SYNC_PUSH_RATE_LIMIT_WINDOW_MS) || 60 * 1000,
        max: Number(process.env.SYNC_PUSH_RATE_LIMIT_MAX) || 120,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res) => {
            res.status(429).json({
                success: false,
                statusCode: 429,
                message: ERROR_MESSAGES.AUTH.TOO_MANY_REQUESTS,
            })
        },
    })

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * SEC-26: everything under /api/v1 was unmetered except auth and sync-push. Mounted once
 * at the app level, this only meters mutating verbs so read-heavy pages (dashboard, reports)
 * stay unaffected; per-route limiters (auth, sync-push) still layer on top of this one.
 */
export const createGlobalRateLimiter = () =>
    rateLimit({
        windowMs: Number(process.env.GLOBAL_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
        max: Number(process.env.GLOBAL_RATE_LIMIT_MAX) || 300,
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => !MUTATING_METHODS.has(req.method),
        handler: (_req, res) => {
            res.status(429).json({
                success: false,
                statusCode: 429,
                message: ERROR_MESSAGES.AUTH.TOO_MANY_REQUESTS,
            })
        },
    })
