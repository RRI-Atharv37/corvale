import { NextFunction, Response } from 'express'

import { AuthRequest } from './authTypes'

const LEGACY_LEDGER_DEPRECATION = {
    deprecation: true,
    sunset: 'pending Phase 1c.3',
    successor: '/api/v1/transactions',
    message:
        'The /income and /expense APIs are deprecated. Use /api/v1/transactions instead.',
}

export const deprecateLegacyLedgerRoutes = (
    _req: AuthRequest,
    res: Response,
    next: NextFunction
): void => {
    res.set('Deprecation', 'true')
    res.set('Link', '</api/v1/transactions>; rel="successor-version"')
    res.set('X-API-Warn', LEGACY_LEDGER_DEPRECATION.message)
    res.locals.legacyLedgerDeprecation = LEGACY_LEDGER_DEPRECATION
    next()
}

export const attachLegacyLedgerDeprecation = (
    _req: AuthRequest,
    res: Response,
    next: NextFunction
): void => {
    const deprecation = res.locals.legacyLedgerDeprecation
    if (!deprecation) {
        next()
        return
    }

    const originalJson = res.json.bind(res)
    res.json = (body: unknown) => {
        if (body && typeof body === 'object' && !Array.isArray(body)) {
            return originalJson({
                ...(body as Record<string, unknown>),
                _deprecated: deprecation,
            })
        }

        return originalJson(body)
    }

    next()
}
