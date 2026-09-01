import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import mongoose from 'mongoose'
import { createApp } from '../app'
import { authHeader, registerUser } from './helpers'

/**
 * Acceptance spec for API production hardening (S1, SEC-07/SEC-08/SEC-10/SEC-12/SEC-25).
 *
 * None of this is implemented yet. Contract assumed here:
 *
 *   - `validateEnv(env)` in `backend/utils/envValidation.ts` throws a plain
 *     Error listing every missing required var (MONGO_URI, JWT_SECRET,
 *     JWT_EXPIRY, CLIENT_URL) and is called at the top of `createApp()`, so
 *     a misconfigured process fails to boot instead of degrading silently
 *     (SEC-12). Every existing test already sets all four in `tests/setup.mts`,
 *     so this is safe to wire in without breaking the rest of the suite.
 *   - Helmet is mounted globally (SEC-07): `nosniff`, no `X-Powered-By`,
 *     `frame-ancestors`/deny, a restrictive API CSP, and an HSTS header.
 *   - `express.json({ limit: '1mb' })` replaces the bare `express.json()`
 *     default so oversized bodies 413 instead of silently inheriting
 *     body-parser's 100kb default (SEC-08).
 *   - `GET /health` (liveness) and `GET /ready` (readiness, checks Mongo's
 *     connection state) exist, unauthenticated, outside `/api/v1` (SEC-25).
 *   - A JSON 404 handler is mounted before the error handler so an unknown
 *     route returns the `{ success, statusCode, message }` shape instead of
 *     Express's default HTML error page (SEC-25).
 *   - CORS fails closed: an unset `CLIENT_URL` refuses to boot (via
 *     `validateEnv`), and a request from an origin that isn't `CLIENT_URL`
 *     gets no `Access-Control-Allow-Origin` header at all (SEC-10).
 */

describe('API hardening — security headers (SEC-07)', () => {
    it('sets nosniff, hides X-Powered-By, and denies framing', async () => {
        const app = createApp()
        const res = await request(app).get('/health')

        expect(res.headers['x-content-type-options']).toBe('nosniff')
        expect(res.headers['x-powered-by']).toBeUndefined()
        expect(
            res.headers['x-frame-options'] === 'DENY' ||
                (res.headers['content-security-policy'] ?? '').includes('frame-ancestors')
        ).toBe(true)
    })

    it('sets a restrictive API Content-Security-Policy', async () => {
        const app = createApp()
        const res = await request(app).get('/health')

        expect(res.headers['content-security-policy']).toBeTruthy()
        expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/)
    })

    it('sets Strict-Transport-Security', async () => {
        const app = createApp()
        const res = await request(app).get('/health')

        expect(res.headers['strict-transport-security']).toBeTruthy()
    })

    it('sends HSTS with a max-age of at least one year, matching the frontend (SEC-68)', async () => {
        const app = createApp()
        const res = await request(app).get('/health')

        const hsts = res.headers['strict-transport-security'] ?? ''
        const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? '0')
        expect(maxAge).toBeGreaterThanOrEqual(31536000)
        expect(hsts).toMatch(/includeSubDomains/i)
    })

    it('sends a restrictive Permissions-Policy (SEC-68)', async () => {
        const app = createApp()
        const res = await request(app).get('/health')

        const policy = res.headers['permissions-policy'] ?? ''
        expect(policy).toBeTruthy()
        // The app uses none of these powerful features — each must be denied to all origins.
        for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) {
            expect(policy).toMatch(new RegExp(`${feature}=\\(\\)`))
        }
    })
})

describe('API hardening — request body limit (SEC-08)', () => {
    it('rejects a JSON body over the configured limit with 413', async () => {
        const app = createApp()
        const { token } = await registerUser(app, { email: 'body-limit@example.com' })

        const oversizedName = 'a'.repeat(2 * 1024 * 1024)
        const res = await request(app)
            .post('/api/v1/tags')
            .set(authHeader(token))
            .send({ name: oversizedName })

        expect(res.status).toBe(413)
    })

    it('accepts a normal-sized JSON body', async () => {
        const app = createApp()
        const { token } = await registerUser(app, { email: 'body-normal@example.com' })

        const res = await request(app).post('/api/v1/tags').set(authHeader(token)).send({ name: 'groceries' })

        expect(res.status).toBe(201)
    })
})

describe('API hardening — health and readiness (SEC-25)', () => {
    it('GET /health reports ok without touching the database', async () => {
        const app = createApp()
        const res = await request(app).get('/health')

        expect(res.status).toBe(200)
        expect(res.body?.data?.status ?? res.body?.status).toBe('ok')
    })

    it('GET /ready reports ok when Mongo is connected', async () => {
        const app = createApp()
        const res = await request(app).get('/ready')

        expect(res.status).toBe(200)
    })

    it('GET /ready reports unavailable when Mongo is not connected', async () => {
        const app = createApp()
        const originalState = mongoose.connection.readyState

        // @ts-expect-error -- readyState has a setter on mongoose's Connection; simulating a
        // disconnected state without tearing down the shared test connection.
        mongoose.connection.readyState = 0
        try {
            const res = await request(app).get('/ready')
            expect(res.status).toBe(503)
        } finally {
            // @ts-expect-error -- restoring the real state for every other test file.
            mongoose.connection.readyState = originalState
        }
    })
})

describe('API hardening — JSON 404 (SEC-25)', () => {
    it('returns a JSON 404 for an unknown API route', async () => {
        const app = createApp()
        const res = await request(app).get('/api/v1/this-route-does-not-exist')

        expect(res.status).toBe(404)
        expect(res.headers['content-type']).toMatch(/json/)
        expect(res.body).toMatchObject({ success: false, statusCode: 404 })
        expect(typeof res.body.message).toBe('string')
    })

    it('returns a JSON 404 for an unknown route outside /api/v1 too', async () => {
        const app = createApp()
        const res = await request(app).get('/totally/unknown/path')

        expect(res.status).toBe(404)
        expect(res.headers['content-type']).toMatch(/json/)
    })
})

describe('API hardening — env validation (SEC-12)', () => {
    const originalClientUrl = process.env.CLIENT_URL
    const originalJwtSecret = process.env.JWT_SECRET
    const originalJwtExpiry = process.env.JWT_EXPIRY
    const originalMongoUri = process.env.MONGO_URI

    afterEach(() => {
        process.env.CLIENT_URL = originalClientUrl
        process.env.JWT_SECRET = originalJwtSecret
        process.env.JWT_EXPIRY = originalJwtExpiry
        process.env.MONGO_URI = originalMongoUri
    })

    it('refuses to boot when CLIENT_URL is unset', () => {
        delete process.env.CLIENT_URL
        expect(() => createApp()).toThrow(/CLIENT_URL/)
    })

    it('refuses to boot when JWT_EXPIRY is unset (non-expiring access tokens otherwise)', () => {
        delete process.env.JWT_EXPIRY
        expect(() => createApp()).toThrow(/JWT_EXPIRY/)
    })

    it('refuses to boot when JWT_SECRET is unset', () => {
        delete process.env.JWT_SECRET
        expect(() => createApp()).toThrow(/JWT_SECRET/)
    })

    it('boots normally when every required var is set', () => {
        expect(() => createApp()).not.toThrow()
    })
})

describe('API hardening — CORS fail-closed (SEC-10)', () => {
    it('reflects Access-Control-Allow-Origin for the configured CLIENT_URL', async () => {
        const app = createApp()
        const res = await request(app).get('/health').set('Origin', process.env.CLIENT_URL as string)

        expect(res.headers['access-control-allow-origin']).toBe(process.env.CLIENT_URL)
    })

    it('sets no Access-Control-Allow-Origin for a disallowed origin (fails closed, not "*")', async () => {
        const app = createApp()
        const res = await request(app).get('/health').set('Origin', 'https://evil.example.com')

        expect(res.headers['access-control-allow-origin']).toBeUndefined()
        expect(res.headers['access-control-allow-origin']).not.toBe('*')
    })
})

describe('API hardening — CORS desktop origin allowlist (SEC-10, S17)', () => {
    it.each(['tauri://localhost', 'http://tauri.localhost'])(
        'reflects Access-Control-Allow-Origin for the desktop origin %s',
        async (origin) => {
            const app = createApp()
            const res = await request(app).get('/health').set('Origin', origin)

            expect(res.headers['access-control-allow-origin']).toBe(origin)
        }
    )

    it('still fails closed for an arbitrary origin once the desktop origins are admitted', async () => {
        const app = createApp()
        const res = await request(app).get('/health').set('Origin', 'https://evil.example.com')

        expect(res.headers['access-control-allow-origin']).toBeUndefined()
    })
})
