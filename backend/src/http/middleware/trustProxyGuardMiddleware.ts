import { Request, Response, NextFunction, RequestHandler } from 'express'

import { logger } from '@infra/observability/logger'

/**
 * SEC-90: with `trust proxy` off, a proxied request makes every rate limiter and the admin IP
 * allowlist key on the proxy's address. A production process that sees a forwarding header while
 * the setting is off is almost certainly misconfigured, so say so once instead of failing quietly.
 */
export const createTrustProxyGuard = (): RequestHandler => {
    let warned = false

    return (req: Request, _res: Response, next: NextFunction): void => {
        if (!warned && process.env.NODE_ENV === 'production' && req.headers['x-forwarded-for'] && !req.app.get('trust proxy')) {
            warned = true
            logger.warn(
                'Received a proxied request while TRUST_PROXY is off: rate limits and ADMIN_IP_ALLOWLIST see the proxy address, not the client. Set TRUST_PROXY to the number of proxy hops (1 behind Caddy).'
            )
        }
        next()
    }
}
