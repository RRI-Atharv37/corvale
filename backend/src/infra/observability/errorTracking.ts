import * as Sentry from '@sentry/node'
import type { ErrorEvent } from '@sentry/node'

export interface ErrorTrackingClient {
    captureException(err: unknown, context?: Record<string, unknown>): void
}

let testClient: ErrorTrackingClient | null = null

/** Test-only hook to capture reported exceptions without a live Sentry DSN. */
export const setErrorTrackingClient = (client: ErrorTrackingClient | null): void => {
    testClient = client
}

export const isErrorTrackingConfigured = (): boolean => Boolean(process.env.SENTRY_DSN)

/**
 * Reduces a Sentry event to what the Privacy Policy commits to sending: the error message,
 * its stack trace, and the failing request's method and path. Everything else an SDK
 * integration might attach -- IP address, request headers, cookies, query string, request
 * body, user identity, the server's hostname, captured breadcrumbs -- is removed here rather
 * than trusted to an SDK default that a version bump or a stray config could flip.
 *
 * See the "Operational data" section of `frontend/corvale/src/legal/privacy.md`. Keep this in
 * sync with that wording: loosening the scrubber means changing the published promise first.
 */
export const scrubErrorEvent = (event: ErrorEvent): ErrorEvent => {
    delete event.user
    delete event.server_name
    delete event.breadcrumbs

    if (event.request) {
        const method = typeof event.request.method === 'string' ? event.request.method : undefined
        let path: string | undefined
        if (typeof event.request.url === 'string') {
            try {
                path = new URL(event.request.url).pathname
            } catch {
                // Relative URL -- drop anything from the first "?" onward.
                path = event.request.url.split('?')[0]
            }
        }
        event.request = {}
        if (method) event.request.method = method
        if (path) event.request.url = path
    }

    // `event.extra` carries the { statusCode, path, method } that errorMiddleware passes in --
    // within the policy. `event.contexts` defaults to server runtime/OS info, not user data.
    return event
}

let initialized = false

/** Called once at process startup (server.ts); a no-op unless SENTRY_DSN is set. */
export const initErrorTracking = (): void => {
    if (initialized || !isErrorTrackingConfigured()) return
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
        tracesSampleRate: 0,
        // The Privacy Policy promises error reports carry no IP address, request body, or
        // user records. Make that explicit rather than leaning on the SDK default, and scrub
        // every event down to message + stack + method + path on the way out.
        sendDefaultPii: false,
        beforeSend: (event) => scrubErrorEvent(event),
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
