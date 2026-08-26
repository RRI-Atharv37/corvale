import { EventEmitter } from 'events'
import http from 'http'

import { describe, it, expect, vi, afterEach } from 'vitest'

import {
    DEFAULT_DRAIN_TIMEOUT_MS,
    drainAndExit,
    registerGracefulShutdown,
} from '../utils/gracefulShutdown'

/**
 * Acceptance spec for graceful shutdown (L8, SEC-25's shutdown half).
 *
 * S1/T0 already covered SEC-25's health/404 half. What's left, called out explicitly by
 * SEC-25's recommendation: `backend/server.ts` currently calls `process.exit(1)` on any
 * unhandled rejection with no drain, no in-flight request completion, and no `SIGTERM`
 * handler at all.
 *
 * Contract assumed here for the new `backend/utils/gracefulShutdown.ts` module:
 *
 *   export interface GracefulShutdownDeps {
 *     closeServer?: (server: http.Server) => Promise<void>
 *     closeMongo?: () => Promise<void>
 *     exit?: (code: number) => void
 *     drainTimeoutMs?: number
 *     signalSource?: NodeJS.EventEmitter   // defaults to the real `process` in server.ts
 *   }
 *   export const DEFAULT_DRAIN_TIMEOUT_MS: number
 *   export const drainAndExit(server, exitCode, deps?): Promise<void>
 *     - closes the HTTP server (stops accepting new connections, waits for in-flight ones),
 *       then closes the Mongo connection, then calls exit(exitCode); a drain that hangs past
 *       drainTimeoutMs forces the exit anyway.
 *   export const registerGracefulShutdown(server, deps?): () => void
 *     - listens for SIGTERM/SIGINT (drain, exit 0) and unhandledRejection (log, drain, exit 1
 *       -- never a bare process.exit(1)); returns an unregister function; a signal firing
 *       twice only drains once.
 *
 * `signalSource` is the test seam (mirrors `mailService.ts`'s `setMailTransport`): tests pass
 * a bare `EventEmitter` instead of the real `process`, so emitting 'SIGTERM' here can never
 * actually terminate the test runner, and `exit` is always a spy, never the real
 * `process.exit`.
 */

const createServer = (): Promise<http.Server> =>
    new Promise((resolve) => {
        const server = http.createServer((_req, res) => res.end('ok'))
        server.listen(0, () => resolve(server))
    })

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve))

describe('drainAndExit (L8, SEC-25)', () => {
    it('closes the server and Mongo connection, then exits with the given code', async () => {
        const server = await createServer()
        const closeServer = vi.fn().mockResolvedValue(undefined)
        const closeMongo = vi.fn().mockResolvedValue(undefined)
        const exit = vi.fn()

        await drainAndExit(server, 0, { closeServer, closeMongo, exit })

        expect(closeServer).toHaveBeenCalledWith(server)
        expect(closeMongo).toHaveBeenCalledTimes(1)
        expect(exit).toHaveBeenCalledWith(0)
        server.close()
    })

    it('still exits with the requested code if closing the server throws', async () => {
        const server = await createServer()
        const closeServer = vi.fn().mockRejectedValue(new Error('boom'))
        const closeMongo = vi.fn().mockResolvedValue(undefined)
        const exit = vi.fn()

        await drainAndExit(server, 1, { closeServer, closeMongo, exit })

        expect(exit).toHaveBeenCalledWith(1)
        server.close()
    })

    it('has a positive default drain timeout', () => {
        expect(DEFAULT_DRAIN_TIMEOUT_MS).toBeGreaterThan(0)
    })

    it('forces exit if draining exceeds the configured timeout', async () => {
        vi.useFakeTimers()
        try {
            const server = await createServer()
            const closeServer = vi.fn(() => new Promise<void>(() => {}))
            const closeMongo = vi.fn().mockResolvedValue(undefined)
            const exit = vi.fn()

            void drainAndExit(server, 0, { closeServer, closeMongo, exit, drainTimeoutMs: 5000 })
            await vi.advanceTimersByTimeAsync(5000)

            expect(exit).toHaveBeenCalledWith(0)
            server.close()
        } finally {
            vi.useRealTimers()
        }
    })
})

describe('registerGracefulShutdown (L8, SEC-25)', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('SIGTERM drains and exits(0), and a repeated signal only drains once', async () => {
        const server = await createServer()
        const signalSource = new EventEmitter()
        const closeServer = vi.fn().mockResolvedValue(undefined)
        const closeMongo = vi.fn().mockResolvedValue(undefined)
        const exit = vi.fn()

        const unregister = registerGracefulShutdown(server, {
            signalSource,
            closeServer,
            closeMongo,
            exit,
        })

        signalSource.emit('SIGTERM')
        signalSource.emit('SIGTERM')
        await flushMicrotasks()

        expect(closeServer).toHaveBeenCalledTimes(1)
        expect(closeMongo).toHaveBeenCalledTimes(1)
        expect(exit).toHaveBeenCalledTimes(1)
        expect(exit).toHaveBeenCalledWith(0)

        unregister()
        server.close()
    })

    it('SIGINT drains and exits(0) the same way as SIGTERM', async () => {
        const server = await createServer()
        const signalSource = new EventEmitter()
        const closeServer = vi.fn().mockResolvedValue(undefined)
        const closeMongo = vi.fn().mockResolvedValue(undefined)
        const exit = vi.fn()

        const unregister = registerGracefulShutdown(server, {
            signalSource,
            closeServer,
            closeMongo,
            exit,
        })

        signalSource.emit('SIGINT')
        await flushMicrotasks()

        expect(closeServer).toHaveBeenCalledTimes(1)
        expect(exit).toHaveBeenCalledWith(0)

        unregister()
        server.close()
    })

    it('an unhandled rejection drains and exits(1) instead of a bare process.exit(1)', async () => {
        const server = await createServer()
        const signalSource = new EventEmitter()
        const closeServer = vi.fn().mockResolvedValue(undefined)
        const closeMongo = vi.fn().mockResolvedValue(undefined)
        const exit = vi.fn()
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        const unregister = registerGracefulShutdown(server, {
            signalSource,
            closeServer,
            closeMongo,
            exit,
        })

        signalSource.emit('unhandledRejection', new Error('boom'))
        await flushMicrotasks()

        expect(closeServer).toHaveBeenCalledTimes(1)
        expect(closeMongo).toHaveBeenCalledTimes(1)
        expect(exit).toHaveBeenCalledWith(1)
        expect(errorSpy).toHaveBeenCalled()

        unregister()
        server.close()
    })

    it('a SIGTERM after an unhandled rejection does not trigger a second drain', async () => {
        const server = await createServer()
        const signalSource = new EventEmitter()
        const closeServer = vi.fn().mockResolvedValue(undefined)
        const closeMongo = vi.fn().mockResolvedValue(undefined)
        const exit = vi.fn()
        vi.spyOn(console, 'error').mockImplementation(() => {})

        const unregister = registerGracefulShutdown(server, {
            signalSource,
            closeServer,
            closeMongo,
            exit,
        })

        signalSource.emit('unhandledRejection', new Error('boom'))
        await flushMicrotasks()
        signalSource.emit('SIGTERM')
        await flushMicrotasks()

        expect(closeServer).toHaveBeenCalledTimes(1)
        expect(exit).toHaveBeenCalledTimes(1)

        unregister()
        server.close()
    })

    it('unregister stops listening for further signals', async () => {
        const server = await createServer()
        const signalSource = new EventEmitter()
        const closeServer = vi.fn().mockResolvedValue(undefined)
        const closeMongo = vi.fn().mockResolvedValue(undefined)
        const exit = vi.fn()

        const unregister = registerGracefulShutdown(server, {
            signalSource,
            closeServer,
            closeMongo,
            exit,
        })
        unregister()

        signalSource.emit('SIGTERM')
        await flushMicrotasks()

        expect(closeServer).not.toHaveBeenCalled()
        server.close()
    })
})
