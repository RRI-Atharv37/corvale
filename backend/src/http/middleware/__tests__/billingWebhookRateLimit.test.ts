import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createBillingWebhookRateLimiter } from '@http/middleware/rateLimitMiddleware'

/**
 * M3b - the webhook's own per-IP limiter. It meters only deliveries that were refused (a signature
 * that did not verify, a body that did not parse): a provider draining a retry backlog through
 * valid deliveries must never be throttled, while an unauthenticated caller guessing signatures is.
 */

const saved = {
    max: process.env.BILLING_WEBHOOK_RATE_LIMIT_MAX,
    window: process.env.BILLING_WEBHOOK_RATE_LIMIT_WINDOW_MS,
}

const buildApp = (statusFor: (req: express.Request) => number) => {
    const app = express()
    app.post('/hook', createBillingWebhookRateLimiter(), (req, res) => {
        res.status(statusFor(req)).json({ success: statusFor(req) < 400 })
    })
    return app
}

beforeEach(() => {
    process.env.BILLING_WEBHOOK_RATE_LIMIT_MAX = '3'
    process.env.BILLING_WEBHOOK_RATE_LIMIT_WINDOW_MS = '60000'
})

afterEach(() => {
    for (const [key, value] of [
        ['BILLING_WEBHOOK_RATE_LIMIT_MAX', saved.max],
        ['BILLING_WEBHOOK_RATE_LIMIT_WINDOW_MS', saved.window],
    ] as const) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
})

describe('billing webhook rate limiter', () => {
    it('answers 429 once one IP has racked up more refused deliveries than the budget', async () => {
        const app = buildApp(() => 400)

        const statuses: number[] = []
        for (let i = 0; i < 5; i += 1) statuses.push((await request(app).post('/hook')).status)

        expect(statuses).toEqual([400, 400, 400, 429, 429])
    })

    it('never counts accepted deliveries, however many arrive', async () => {
        const app = buildApp(() => 200)

        const statuses: number[] = []
        for (let i = 0; i < 8; i += 1) statuses.push((await request(app).post('/hook')).status)

        expect(statuses.every((status) => status === 200)).toBe(true)
    })

    it('a 429 carries the shared too-many-requests body', async () => {
        const app = buildApp(() => 400)
        for (let i = 0; i < 3; i += 1) await request(app).post('/hook')

        const res = await request(app).post('/hook')

        expect(res.status).toBe(429)
        expect(res.body).toMatchObject({ success: false, statusCode: 429 })
    })
})
