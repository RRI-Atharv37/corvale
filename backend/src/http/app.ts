import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { validateEnv } from '@infra/config/envValidation'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import healthRoutes from './health.routes'
import { mountRoutes } from './routes'
import { sanitizeBody } from '@http/middleware/sanitizeBodyMiddleware'
import { buildCorsOriginAllowlist } from '@infra/config/corsOriginAllowlist'
import { createGlobalRateLimiter } from '@http/middleware/rateLimitMiddleware'
import { errorHandler } from '@http/middleware/errorMiddleware'
import { requestLogger } from '@http/middleware/requestLoggerMiddleware'

/**
 * TRUST_PROXY is unset (false) by default so req.ip is the socket's own address, matching
 * Express's default. Behind a reverse proxy, set it to the number of hops (e.g. "1") or a
 * trusted IP/CIDR list so the rate limiters key on the real client IP instead of the proxy's
 * (SEC-26) — see https://expressjs.com/en/guide/behind-proxies.html.
 */
/**
 * SEC-68: deny every powerful browser feature Corvale never uses. Kept identical to the
 * `Permissions-Policy` in `frontend/corvale/nginx.conf` so the policy reads the same from
 * whichever layer answers.
 */
const PERMISSIONS_POLICY = [
    'accelerometer=()',
    'autoplay=()',
    'camera=()',
    'display-capture=()',
    'encrypted-media=()',
    'fullscreen=(self)',
    'geolocation=()',
    'gyroscope=()',
    'magnetometer=()',
    'microphone=()',
    'midi=()',
    'payment=()',
    'picture-in-picture=()',
    'usb=()',
].join(', ')

const parseTrustProxy = (value: string | undefined): boolean | number | string => {
    if (value === undefined) return false
    if (value === 'true') return true
    if (value === 'false') return false
    const asNumber = Number(value)
    if (value.trim() !== '' && !Number.isNaN(asNumber)) return asNumber
    return value
}

export const createApp = (): express.Application => {
    validateEnv()

    const app = express()
    app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY))

    /**
     * Pin the query parser to 'simple' explicitly (SEC-35). This is already the Express 5
     * default, but `sanitizeBody` only guards `req.body` — `req.query` reaches Mongoose
     * filters (e.g. `buildListFilter`'s `accountId`) unsanitized. The 'simple' parser
     * (Node's `querystring`) cannot produce nested objects, so a bracketed operator like
     * `?accountId[$ne]=` parses to a literal key rather than `{ $ne: ... }`. Switching this
     * to 'extended' would silently make that operator-injection route live, so the choice
     * is recorded here rather than left to an implicit framework default.
     */
    app.set('query parser', 'simple')

    app.use(
        helmet({
            contentSecurityPolicy: {
                useDefaults: false,
                directives: {
                    defaultSrc: ["'none'"],
                    frameAncestors: ["'none'"],
                },
            },
            frameguard: { action: 'deny' },
            crossOriginResourcePolicy: { policy: 'same-origin' },
            // SEC-68: align max-age with the frontend nginx layer (both one year,
            // includeSubDomains). `preload` is deliberately not sent yet — it is a hard-to-reverse
            // commitment for every corvale.app subdomain and is gated on an explicit decision.
            hsts: { maxAge: 31536000, includeSubDomains: true },
        })
    )

    // SEC-68: helmet sends no Permissions-Policy. The API serves JSON, so this is belt-and-braces,
    // but it is sent from both layers so the policy is stated in one form everywhere. Keep this
    // list in sync with `frontend/corvale/nginx.conf`.
    app.use((_req, res, next) => {
        res.setHeader('Permissions-Policy', PERMISSIONS_POLICY)
        next()
    })

    const corsOriginAllowlist = buildCorsOriginAllowlist(process.env.CLIENT_URL as string)

    app.use(
        cors({
            origin: (origin, callback) => {
                if (!origin || corsOriginAllowlist.includes(origin)) {
                    callback(null, true)
                    return
                }
                callback(null, false)
            },
            methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
            allowedHeaders: ['Content-type', 'Authorization'],
            credentials: true,
        })
    )

    app.use(express.json({ limit: '1mb' }))
    app.use(cookieParser())
    app.use(sanitizeBody)
    app.use(requestLogger)

    app.use(healthRoutes)

    app.use('/api/v1', createGlobalRateLimiter())

    mountRoutes(app)

    app.use((_req, res) => {
        res.status(404).json({
            success: false,
            statusCode: 404,
            message: ERROR_MESSAGES.GENERAL.ROUTE_NOT_FOUND,
        })
    })

    app.use(errorHandler)

    return app
}

const app = createApp()
export default app
