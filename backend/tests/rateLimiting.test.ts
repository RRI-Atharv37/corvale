import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../app'
import { authHeader, registerUser } from './helpers'
import { ERROR_MESSAGES } from '../utils/errorMessages'

/**
 * G0 acceptance spec (TODO.md T0 -> S4, SEC-26).
 *
 * Contract assumed here:
 *   - A global limiter (`createGlobalRateLimiter`, new env vars
 *     `GLOBAL_RATE_LIMIT_MAX` / `GLOBAL_RATE_LIMIT_WINDOW_MS`) is mounted at
 *     the app level and applies to every mutating request (POST/PUT/PATCH/
 *     DELETE) under `/api/v1`, not just auth and sync-push.
 *   - `POST /auth/refresh` and `POST /auth/logout` get the same
 *     `createAuthRateLimiter()` already used on `/register`/`/login`/the
 *     password-reset routes, so a stolen-cookie replay loop is throttled
 *     too (today these two routes are exempt — see authRoutes.ts).
 *   - `app.set('trust proxy', ...)` is driven by a `TRUST_PROXY` env var
 *     rather than left at Express's default (`false`), so a reverse-proxied
 *     deployment sees real client IPs instead of one shared proxy IP.
 */

describe('Global rate limiting on mutating routes (SEC-26)', () => {
    const originalMax = process.env.GLOBAL_RATE_LIMIT_MAX
    const originalWindow = process.env.GLOBAL_RATE_LIMIT_WINDOW_MS

    beforeAll(() => {
        process.env.GLOBAL_RATE_LIMIT_MAX = '5'
        process.env.GLOBAL_RATE_LIMIT_WINDOW_MS = '600000'
    })

    afterAll(() => {
        process.env.GLOBAL_RATE_LIMIT_MAX = originalMax
        process.env.GLOBAL_RATE_LIMIT_WINDOW_MS = originalWindow
    })

    it('429s a mutating route after the global max is exceeded', async () => {
        const app = createApp()
        const { token } = await registerUser(app, { email: 'global-limit@example.com' })

        let sawLimit = false
        for (let i = 0; i < 8; i++) {
            const res = await request(app)
                .post('/api/v1/tags')
                .set(authHeader(token))
                .send({ name: `tag-${i}` })

            if (res.status === 429) {
                sawLimit = true
                expect(res.body).toMatchObject({ success: false, statusCode: 429 })
                break
            }
        }

        expect(sawLimit).toBe(true)
    })

    it('does not rate limit read-only (GET) requests under the same threshold', async () => {
        const app = createApp()
        const { token } = await registerUser(app, { email: 'global-limit-read@example.com' })

        for (let i = 0; i < 8; i++) {
            const res = await request(app).get('/api/v1/tags').set(authHeader(token))
            expect(res.status).toBe(200)
        }
    })
})

describe('Dedicated rate limiting on refresh and logout (SEC-26)', () => {
    beforeAll(() => {
        process.env.AUTH_RATE_LIMIT_MAX = '3'
        process.env.AUTH_RATE_LIMIT_WINDOW_MS = '600000'
    })

    it('rate limits POST /auth/refresh after max attempts', async () => {
        const app = createApp()

        for (let i = 0; i < 3; i++) {
            const res = await request(app).post('/api/v1/auth/refresh')
            expect(res.status).not.toBe(429)
        }

        const blocked = await request(app).post('/api/v1/auth/refresh')
        expect(blocked.status).toBe(429)
        expect(blocked.body.message).toBe(ERROR_MESSAGES.AUTH.TOO_MANY_REQUESTS)
    })

    it('rate limits POST /auth/logout after max attempts', async () => {
        const app = createApp()

        for (let i = 0; i < 3; i++) {
            const res = await request(app).post('/api/v1/auth/logout')
            expect(res.status).not.toBe(429)
        }

        const blocked = await request(app).post('/api/v1/auth/logout')
        expect(blocked.status).toBe(429)
        expect(blocked.body.message).toBe(ERROR_MESSAGES.AUTH.TOO_MANY_REQUESTS)
    })
})

describe('Shared rate-limit store across instances (SEC-26, S18)', () => {
    beforeAll(() => {
        process.env.AUTH_RATE_LIMIT_MAX = '3'
        process.env.AUTH_RATE_LIMIT_WINDOW_MS = '600000'
    })

    it('a client blocked on one app instance is also blocked on an independently created instance', async () => {
        // Two createApp() calls stand in for two horizontally-scaled processes: with the old
        // in-memory store each got its own MemoryStore and neither would ever see the other's
        // hits, so the effective limit was silently multiplied by the instance count.
        const instanceA = createApp()
        const instanceB = createApp()

        for (let i = 0; i < 3; i++) {
            const res = await request(instanceA).post('/api/v1/auth/refresh')
            expect(res.status).not.toBe(429)
        }

        const blockedOnB = await request(instanceB).post('/api/v1/auth/refresh')
        expect(blockedOnB.status).toBe(429)
    })

    it('does not let a burst on the refresh/logout limiter consume the register/login budget', async () => {
        const app = createApp()

        for (let i = 0; i < 3; i++) {
            await request(app).post('/api/v1/auth/refresh')
        }

        const res = await request(app).post('/api/v1/auth/login').send({
            email: 'nobody@example.com',
            password: 'wrong-password',
        })

        expect(res.status).not.toBe(429)
    })
})

describe('trust proxy configuration (SEC-26)', () => {
    const original = process.env.TRUST_PROXY

    afterAll(() => {
        process.env.TRUST_PROXY = original
    })

    it('honors TRUST_PROXY so client IPs behind a reverse proxy are not conflated', () => {
        process.env.TRUST_PROXY = '1'
        const app = createApp()

        expect(app.get('trust proxy')).toBeTruthy()
    })

    it('defaults to not trusting the proxy when TRUST_PROXY is unset', () => {
        delete process.env.TRUST_PROXY
        const app = createApp()

        expect(app.get('trust proxy')).toBeFalsy()
    })
})
