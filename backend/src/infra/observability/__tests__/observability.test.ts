import { describe, it, expect, afterEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

import { logger, setLoggerWriter } from '@infra/observability/logger'
import {
    setErrorTrackingClient,
    isErrorTrackingConfigured,
    captureException,
    scrubErrorEvent,
} from '@infra/observability/errorTracking'
import type { ErrorEvent } from '@sentry/node'
import { requestLogger } from '@http/middleware/requestLoggerMiddleware'
import { errorHandler } from '@http/middleware/errorMiddleware'
import { CustomError } from '@core/errors/customError'

/**
 * Acceptance spec for L4 — error tracking + structured logging + uptime monitoring.
 *
 * Contract assumed here, mirroring `mailService.ts`'s injectable-transport seam:
 *
 *   backend/utils/logger.ts
 *     export const logger: { info/warn/error(message, meta?) }
 *     export const setLoggerWriter(writer | null)  -- test-only hook; when set, every emitted
 *       line goes through it instead of the real stdout/stderr, as a single JSON string per call.
 *     Each line is `{ timestamp, level, message, ...meta }` -- structured, one object per line.
 *
 *   backend/utils/errorTracking.ts
 *     export const isErrorTrackingConfigured(): boolean  -- true iff SENTRY_DSN is set
 *     export const setErrorTrackingClient(client | null)  -- test-only hook (mirrors
 *       setMailTransport); takes priority over the real Sentry client regardless of
 *       SENTRY_DSN, so tests never need a live DSN.
 *     export const captureException(err, context?): void  -- no-ops when neither a test
 *       client nor SENTRY_DSN is present.
 *     export const scrubErrorEvent(event): event  -- the beforeSend scrubber; reduces an
 *       event to message + stack + request method + path, matching the Privacy Policy's
 *       "Operational data" promise. Wired into Sentry.init alongside sendDefaultPii: false.
 *
 *   backend/middleware/requestLoggerMiddleware.ts
 *     export const requestLogger  -- Express middleware; on response finish, emits one
 *       structured `logger.info` line per request (method, path, statusCode, durationMs),
 *       skipping /health and /ready to avoid drowning real logs in uptime-monitor pings.
 *
 *   backend/middleware/errorMiddleware.ts (existing file, extended)
 *     - logs every error via `logger.error`
 *     - forwards only 5xx errors to `captureException` (4xx client errors are not reported)
 *
 * Uptime monitoring itself has no application code -- /health and /ready already exist
 * (S1/SEC-25) and are documented in docs/developers/environment-variables.md as the
 * endpoints an external uptime monitor should poll.
 */

describe('logger (L4)', () => {
    afterEach(() => {
        setLoggerWriter(null)
    })

    it('emits one structured JSON line per call, with timestamp/level/message/meta', () => {
        const lines: string[] = []
        setLoggerWriter((line) => lines.push(line))

        logger.info('user signed in', { userId: 'abc123' })

        expect(lines).toHaveLength(1)
        const parsed = JSON.parse(lines[0])
        expect(parsed.level).toBe('info')
        expect(parsed.message).toBe('user signed in')
        expect(parsed.userId).toBe('abc123')
        expect(typeof parsed.timestamp).toBe('string')
        expect(new Date(parsed.timestamp).toString()).not.toBe('Invalid Date')
    })

    it('tags warn and error calls with the matching level', () => {
        const lines: string[] = []
        setLoggerWriter((line) => lines.push(line))

        logger.warn('rate limit approaching')
        logger.error('database unreachable', { code: 'ECONNREFUSED' })

        expect(JSON.parse(lines[0]).level).toBe('warn')
        const errorLine = JSON.parse(lines[1])
        expect(errorLine.level).toBe('error')
        expect(errorLine.code).toBe('ECONNREFUSED')
    })

    it('writes error-level lines to stderr and info-level lines to stdout by default', () => {
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

        try {
            logger.info('routine event')
            logger.error('failure event')

            expect(stdoutSpy).toHaveBeenCalledTimes(1)
            expect(stdoutSpy.mock.calls[0][0]).toContain('routine event')
            expect(stderrSpy).toHaveBeenCalledTimes(1)
            expect(stderrSpy.mock.calls[0][0]).toContain('failure event')
        } finally {
            stdoutSpy.mockRestore()
            stderrSpy.mockRestore()
        }
    })
})

describe('errorTracking (L4)', () => {
    afterEach(() => {
        setErrorTrackingClient(null)
        delete process.env.SENTRY_DSN
    })

    it('reports not configured when SENTRY_DSN is unset', () => {
        delete process.env.SENTRY_DSN
        expect(isErrorTrackingConfigured()).toBe(false)
    })

    it('reports configured once SENTRY_DSN is set', () => {
        process.env.SENTRY_DSN = 'https://example@o0.ingest.sentry.io/0'
        expect(isErrorTrackingConfigured()).toBe(true)
    })

    it('no-ops when neither a test client nor SENTRY_DSN is present', () => {
        delete process.env.SENTRY_DSN
        expect(() => captureException(new Error('boom'))).not.toThrow()
    })

    it('forwards to an injected test client regardless of SENTRY_DSN, taking priority', () => {
        delete process.env.SENTRY_DSN
        const captured: Array<{ err: unknown; context?: Record<string, unknown> }> = []
        setErrorTrackingClient({
            captureException: (err, context) => {
                captured.push({ err, context })
            },
        })

        const error = new Error('payment failed')
        captureException(error, { statusCode: 500, path: '/api/v1/transactions' })

        expect(captured).toHaveLength(1)
        expect(captured[0].err).toBe(error)
        expect(captured[0].context).toEqual({ statusCode: 500, path: '/api/v1/transactions' })
    })

    it('scrubErrorEvent keeps only message, stack, request method and path (R9)', () => {
        const scrubbed = scrubErrorEvent({
            message: 'boom',
            exception: { values: [{ type: 'Error', value: 'boom', stacktrace: { frames: [] } }] },
            extra: { statusCode: 500, path: '/api/v1/transactions/6512', method: 'POST' },
            user: { id: 'u_123', email: 'a@b.com', ip_address: '203.0.113.7' },
            server_name: 'corvale-vm-1',
            breadcrumbs: [{ message: 'GET /api/v1/transactions?token=supersecret' }],
            request: {
                method: 'POST',
                url: 'https://api.corvale.app/api/v1/transactions/6512?token=supersecret',
                headers: { authorization: 'Bearer supersecret', cookie: 'corvale_refresh=y' },
                cookies: { corvale_refresh: 'y' },
                data: { amount: 5000, note: 'private note' },
                query_string: 'token=supersecret',
            },
        } as unknown as ErrorEvent)

        expect(scrubbed.user).toBeUndefined()
        expect(scrubbed.server_name).toBeUndefined()
        expect(scrubbed.breadcrumbs).toBeUndefined()
        expect(scrubbed.request).toEqual({ method: 'POST', url: '/api/v1/transactions/6512' })

        // Message and stack trace survive -- they are what the report is for.
        expect(scrubbed.message).toBe('boom')
        expect(scrubbed.exception?.values?.[0]?.stacktrace).toBeDefined()
        // The { statusCode, path, method } errorMiddleware passes as extra is within the policy.
        expect(scrubbed.extra).toEqual({ statusCode: 500, path: '/api/v1/transactions/6512', method: 'POST' })

        // Nothing sensitive anywhere in the serialized event.
        expect(JSON.stringify(scrubbed)).not.toContain('supersecret')
        expect(JSON.stringify(scrubbed)).not.toContain('private note')
        expect(JSON.stringify(scrubbed)).not.toContain('203.0.113.7')
    })

    it('scrubErrorEvent tolerates an event with no request or relative url', () => {
        expect(scrubErrorEvent({ message: 'boom' } as ErrorEvent).request).toBeUndefined()

        const relative = scrubErrorEvent({
            request: { method: 'GET', url: '/api/v1/health?probe=1' },
        } as unknown as ErrorEvent)
        expect(relative.request).toEqual({ method: 'GET', url: '/api/v1/health' })
    })
})

describe('requestLogger middleware (L4)', () => {
    afterEach(() => {
        setLoggerWriter(null)
    })

    it('logs method, path, statusCode, and durationMs on response finish', async () => {
        const lines: string[] = []
        setLoggerWriter((line) => lines.push(line))

        const app = express()
        app.use(requestLogger)
        app.get('/api/v1/__test/ok', (_req, res) => {
            res.status(200).json({ success: true })
        })

        await request(app).get('/api/v1/__test/ok')
        await new Promise((resolve) => setImmediate(resolve))

        expect(lines).toHaveLength(1)
        const parsed = JSON.parse(lines[0])
        expect(parsed.method).toBe('GET')
        expect(parsed.path).toBe('/api/v1/__test/ok')
        expect(parsed.statusCode).toBe(200)
        expect(typeof parsed.durationMs).toBe('number')
    })

    it('does not log /health or /ready, so uptime-monitor polling stays out of the log stream', async () => {
        const lines: string[] = []
        setLoggerWriter((line) => lines.push(line))

        const app = express()
        app.use(requestLogger)
        app.get('/health', (_req, res) => {
            res.status(200).json({ success: true })
        })
        app.get('/ready', (_req, res) => {
            res.status(200).json({ success: true })
        })

        await request(app).get('/health')
        await request(app).get('/ready')
        await new Promise((resolve) => setImmediate(resolve))

        expect(lines).toHaveLength(0)
    })
})

describe('errorHandler observability wiring (L4)', () => {
    afterEach(() => {
        setLoggerWriter(null)
        setErrorTrackingClient(null)
    })

    const createApp = (err: Error): express.Application => {
        const app = express()
        app.get('/api/v1/__test/error', (_req, _res, next) => next(err))
        app.use(errorHandler)
        return app
    }

    it('logs every error via the structured logger', async () => {
        const lines: string[] = []
        setLoggerWriter((line) => lines.push(line))

        await request(createApp(new CustomError('Not found', 404))).get('/api/v1/__test/error')

        expect(lines.length).toBeGreaterThan(0)
        const parsed = JSON.parse(lines[0])
        expect(parsed.level).toBe('error')
        expect(parsed.statusCode).toBe(404)
    })

    it('reports 5xx errors to error tracking', async () => {
        setLoggerWriter(() => {})
        const captured: unknown[] = []
        setErrorTrackingClient({ captureException: (err) => captured.push(err) })

        const boom = new Error('unexpected failure')
        await request(createApp(boom)).get('/api/v1/__test/error')

        expect(captured).toHaveLength(1)
        expect(captured[0]).toBe(boom)
    })

    it('does not report 4xx CustomErrors to error tracking', async () => {
        setLoggerWriter(() => {})
        const captured: unknown[] = []
        setErrorTrackingClient({ captureException: (err) => captured.push(err) })

        await request(createApp(new CustomError('Bad input', 400))).get('/api/v1/__test/error')

        expect(captured).toHaveLength(0)
    })
})
