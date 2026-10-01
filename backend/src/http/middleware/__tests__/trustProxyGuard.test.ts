import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createTrustProxyGuard } from '@http/middleware/trustProxyGuardMiddleware'
import { createApp } from '@http/app'
import { setLoggerWriter } from '@infra/observability/logger'

/**
 * Acceptance spec for SEC-90 (S57): a production process that receives proxied traffic while
 * `trust proxy` is off must say so in the logs, because every limiter and the admin IP allowlist
 * silently collapse onto the proxy's address in that state.
 */

const buildApp = (trustProxy: unknown) => {
    const app = express()
    app.set('trust proxy', trustProxy)
    app.use(createTrustProxyGuard())
    app.get('/ping', (_req, res) => {
        res.json({ ok: true })
    })
    return app
}

describe('trust proxy guard (SEC-90)', () => {
    const originalEnv = process.env.NODE_ENV
    let lines: string[]

    beforeEach(() => {
        lines = []
        setLoggerWriter((line) => lines.push(line))
    })

    afterEach(() => {
        setLoggerWriter(null)
        process.env.NODE_ENV = originalEnv
    })

    const warnings = () => lines.map((l) => JSON.parse(l)).filter((l) => l.level === 'warn')

    it('warns in production when a proxied request arrives with trust proxy off', async () => {
        process.env.NODE_ENV = 'production'
        const res = await request(buildApp(false)).get('/ping').set('X-Forwarded-For', '203.0.113.9')

        expect(res.status).toBe(200)
        expect(warnings()).toHaveLength(1)
        expect(warnings()[0].message).toMatch(/TRUST_PROXY/)
    })

    it('warns only once per process, not once per request', async () => {
        process.env.NODE_ENV = 'production'
        const app = buildApp(false)
        await request(app).get('/ping').set('X-Forwarded-For', '203.0.113.9')
        await request(app).get('/ping').set('X-Forwarded-For', '203.0.113.10')
        await request(app).get('/ping').set('X-Forwarded-For', '203.0.113.11')

        expect(warnings()).toHaveLength(1)
    })

    it('stays silent when trust proxy is on', async () => {
        process.env.NODE_ENV = 'production'
        await request(buildApp(1)).get('/ping').set('X-Forwarded-For', '203.0.113.9')

        expect(warnings()).toHaveLength(0)
    })

    it('stays silent when no forwarding header is present', async () => {
        process.env.NODE_ENV = 'production'
        await request(buildApp(false)).get('/ping')

        expect(warnings()).toHaveLength(0)
    })

    it('stays silent outside production', async () => {
        process.env.NODE_ENV = 'development'
        await request(buildApp(false)).get('/ping').set('X-Forwarded-For', '203.0.113.9')

        expect(warnings()).toHaveLength(0)
    })

    it('is mounted by createApp', async () => {
        process.env.NODE_ENV = 'production'
        const original = process.env.TRUST_PROXY
        delete process.env.TRUST_PROXY
        try {
            const app = createApp()
            await request(app).get('/health').set('X-Forwarded-For', '203.0.113.9')
            expect(warnings().some((w) => /TRUST_PROXY/.test(w.message))).toBe(true)
        } finally {
            if (original === undefined) delete process.env.TRUST_PROXY
            else process.env.TRUST_PROXY = original
        }
    })
})
