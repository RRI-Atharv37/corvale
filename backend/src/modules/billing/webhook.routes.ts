import express from 'express'

import { createBillingWebhookRateLimiter } from '@http/middleware/rateLimitMiddleware'

import { receiveBillingWebhook } from './webhook.controller'

const WEBHOOK_BODY_LIMIT = '256kb'

/**
 * Mounted by `app.ts` ahead of `express.json`, the body sanitiser and the `/api/v1` limiter: the
 * signature covers the exact bytes the provider sent, so the body stays a raw Buffer here. There is
 * deliberately no `protect` - the signature is the only credential.
 */
export const createBillingWebhookRoutes = (): express.Router => {
    const router = express.Router()

    router.post(
        '/',
        createBillingWebhookRateLimiter(),
        express.raw({ type: () => true, limit: WEBHOOK_BODY_LIMIT }),
        receiveBillingWebhook
    )

    return router
}
