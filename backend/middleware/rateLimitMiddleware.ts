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
