import rateLimit from 'express-rate-limit'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { MongoRateLimitStore } from '../utils/mongoRateLimitStore'

/**
 * `prefix` identifies this limiter's own budget in the shared Mongo store (SEC-26/S18) — each
 * call site must pass a distinct value so, e.g., a refresh/logout burst can't also consume the
 * register/login budget. Previously that isolation came for free from each call getting its own
 * in-memory `MemoryStore`; a shared store needs it spelled out explicitly.
 */
export const createAuthRateLimiter = (prefix: string) =>
    rateLimit({
        windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
        max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 10,
        standardHeaders: true,
        legacyHeaders: false,
        store: new MongoRateLimitStore(prefix),
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
        store: new MongoRateLimitStore('sync-push'),
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
 *
 * All three limiters here are backed by `MongoRateLimitStore` rather than the default
 * in-memory store, so counters are shared across horizontally-scaled instances instead of
 * being multiplied by the instance count (SEC-26/S18).
 */
export const createGlobalRateLimiter = () =>
    rateLimit({
        windowMs: Number(process.env.GLOBAL_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
        max: Number(process.env.GLOBAL_RATE_LIMIT_MAX) || 300,
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => !MUTATING_METHODS.has(req.method),
        store: new MongoRateLimitStore('global'),
        handler: (_req, res) => {
            res.status(429).json({
                success: false,
                statusCode: 429,
                message: ERROR_MESSAGES.AUTH.TOO_MANY_REQUESTS,
            })
        },
    })
