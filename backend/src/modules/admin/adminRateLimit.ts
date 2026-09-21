import rateLimit, { ipKeyGenerator } from 'express-rate-limit'

import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { MongoRateLimitStore } from '@infra/rateLimit/mongoRateLimitStore'

const tooMany = (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }): void => {
    res.status(429).json({ success: false, statusCode: 429, message: ERROR_MESSAGES.AUTH.TOO_MANY_REQUESTS })
}

/** Login attempts are metered per address + email, so one noisy address cannot lock a different admin out. */
export const createAdminLoginRateLimiter = () =>
    rateLimit({
        windowMs: Number(process.env.ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
        max: Number(process.env.ADMIN_LOGIN_RATE_LIMIT_MAX) || 10,
        standardHeaders: true,
        legacyHeaders: false,
        store: new MongoRateLimitStore('admin-login'),
        keyGenerator: (req) => {
            const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : ''
            return `${ipKeyGenerator(req.ip ?? '')}|${email}`
        },
        handler: tooMany,
    })

/** Enrolment tokens are 256-bit, but the endpoint still takes a password guess on re-enrolment, so it is metered per address. */
export const createAdminEnrolRateLimiter = () =>
    rateLimit({
        windowMs: Number(process.env.ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
        max: Number(process.env.ADMIN_LOGIN_RATE_LIMIT_MAX) || 10,
        standardHeaders: true,
        legacyHeaders: false,
        store: new MongoRateLimitStore('admin-enrol'),
        keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
        handler: tooMany,
    })

/** Refresh, logout and step-up sit behind the ordinary per-address budget. */
export const createAdminSessionRateLimiter = () =>
    rateLimit({
        windowMs: Number(process.env.ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
        max: (Number(process.env.ADMIN_LOGIN_RATE_LIMIT_MAX) || 10) * 6,
        standardHeaders: true,
        legacyHeaders: false,
        store: new MongoRateLimitStore('admin-session'),
        keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
        handler: tooMany,
    })
