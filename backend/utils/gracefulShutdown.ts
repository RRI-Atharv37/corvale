import type { Server } from 'http'

import mongoose from 'mongoose'

/**
 * L8 / SEC-25: replaces the bare `process.exit(1)` on unhandled rejection with a drain —
 * stop accepting new connections, let in-flight requests finish, close Mongo, then exit.
 * `signalSource` mirrors `mailService.ts`'s `setMailTransport` test seam: production wires
 * this to the real `process`; tests pass a plain `EventEmitter` so a simulated SIGTERM can
 * never actually kill the test runner.
 */
export interface GracefulShutdownDeps {
    closeServer?: (server: Server) => Promise<void>
    closeMongo?: () => Promise<void>
    exit?: (code: number) => void
    drainTimeoutMs?: number
    signalSource?: NodeJS.EventEmitter
}

export const DEFAULT_DRAIN_TIMEOUT_MS = 10_000

const defaultCloseServer = (server: Server): Promise<void> =>
    new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
    })

const defaultCloseMongo = (): Promise<void> => mongoose.connection.close()

/**
 * Drains `server` and Mongo, then calls `exit(exitCode)`. If draining hangs past
 * `drainTimeoutMs`, forces the exit anyway rather than leaving the process stuck.
 */
export const drainAndExit = async (
    server: Server,
    exitCode: number,
    deps: GracefulShutdownDeps = {}
): Promise<void> => {
    const closeServer = deps.closeServer ?? defaultCloseServer
    const closeMongo = deps.closeMongo ?? defaultCloseMongo
    const exit = deps.exit ?? process.exit.bind(process)
    const drainTimeoutMs = deps.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS

    let settled = false
    const forceExitTimer = setTimeout(() => {
        if (settled) return
        settled = true
        console.error('Graceful shutdown drain timed out; forcing exit')
        exit(exitCode)
    }, drainTimeoutMs)
    forceExitTimer.unref()

    try {
        await closeServer(server)
        await closeMongo()
    } catch (err) {
        console.error('Error during graceful shutdown:', err)
    } finally {
        clearTimeout(forceExitTimer)
        if (!settled) {
            settled = true
            exit(exitCode)
        }
    }
}

/**
 * Wires SIGTERM/SIGINT (deliberate shutdown, exit 0) and unhandledRejection (log, drain,
 * exit 1) to `drainAndExit`. Idempotent — a second signal while already draining is ignored.
 * Returns an unregister function.
 */
export const registerGracefulShutdown = (
    server: Server,
    deps: GracefulShutdownDeps = {}
): (() => void) => {
    const signalSource = deps.signalSource ?? process
    let shuttingDown = false

    const beginShutdown = (exitCode: number, reason: string): void => {
        if (shuttingDown) return
        shuttingDown = true
        console.log(`${reason} — draining and shutting down`)
        void drainAndExit(server, exitCode, deps)
    }

    const onSigterm = (): void => beginShutdown(0, 'Received SIGTERM')
    const onSigint = (): void => beginShutdown(0, 'Received SIGINT')
    const onUnhandledRejection = (err: unknown): void => {
        console.error('Unhandled Rejection:', err)
        beginShutdown(1, 'Unhandled rejection')
    }

    signalSource.on('SIGTERM', onSigterm)
    signalSource.on('SIGINT', onSigint)
    signalSource.on('unhandledRejection', onUnhandledRejection)

    return () => {
        signalSource.off('SIGTERM', onSigterm)
        signalSource.off('SIGINT', onSigint)
        signalSource.off('unhandledRejection', onUnhandledRejection)
    }
}
