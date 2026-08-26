import * as Sentry from '@sentry/node'

export interface ErrorTrackingClient {
    captureException(err: unknown, context?: Record<string, unknown>): void
}

let testClient: ErrorTrackingClient | null = null

/** Test-only hook to capture reported exceptions without a live Sentry DSN. */
export const setErrorTrackingClient = (client: ErrorTrackingClient | null): void => {
    testClient = client
}

export const isErrorTrackingConfigured = (): boolean => Boolean(process.env.SENTRY_DSN)

let initialized = false

/** Called once at process startup (server.ts); a no-op unless SENTRY_DSN is set. */
export const initErrorTracking = (): void => {
    if (initialized || !isErrorTrackingConfigured()) return
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
        tracesSampleRate: 0,
    })
    initialized = true
}

const sentryClient: ErrorTrackingClient = {
    captureException: (err, context) => {
        Sentry.captureException(err, context ? { extra: context } : undefined)
    },
}

/**
 * Reports `err` to error tracking. An injected test client (see `setErrorTrackingClient`)
 * always takes priority, mirroring `mailService.ts`'s `setMailTransport` seam -- tests never
 * need a live SENTRY_DSN. With no test client and no SENTRY_DSN configured, this is a no-op.
 */
export const captureException = (err: unknown, context?: Record<string, unknown>): void => {
    if (testClient) {
        testClient.captureException(err, context)
        return
    }
    if (!isErrorTrackingConfigured()) return
    sentryClient.captureException(err, context)
}
