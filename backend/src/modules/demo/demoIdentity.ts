/**
 * M9 - the shared, public demo account. Real credentials by design (the whole point is a "View demo"
 * link anyone can use), so both sides default to the same literal value; an operator who wants a
 * different pair sets both `DEMO_ACCOUNT_EMAIL`/`DEMO_ACCOUNT_PASSWORD` here and the matching
 * `VITE_DEMO_EMAIL`/`VITE_DEMO_PASSWORD` on the frontend build.
 *
 * Kept free of model imports: the auth middleware loads this file, and the seeding service (which
 * pulls in most of the app) must not become a dependency of every router.
 */
export const DEFAULT_DEMO_EMAIL = 'demo@corvale.app'
export const DEFAULT_DEMO_PASSWORD = 'CorvaleDemo!2026'

export const getDemoAccountEmail = (): string => process.env.DEMO_ACCOUNT_EMAIL?.trim() || DEFAULT_DEMO_EMAIL
export const getDemoAccountPassword = (): string => process.env.DEMO_ACCOUNT_PASSWORD || DEFAULT_DEMO_PASSWORD

export const isDemoAccountEmail = (email: string | undefined | null): boolean =>
    typeof email === 'string' && email.trim().toLowerCase() === getDemoAccountEmail().toLowerCase()

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** POST routes that only compute a result from the caller's data and write nothing, so the demo can still use them. */
const DEMO_READ_ONLY_POSTS = new Set([
    '/api/v1/categorization-rules/test',
    '/api/v1/imports/parse',
    '/api/v1/imports/preview',
    '/api/v1/debts/plan',
    '/api/v1/dashboard/reports/query',
    '/api/v1/dashboard/reports/generate',
    '/api/v1/backup/preview',
])

const normalisePath = (originalUrl: string): string =>
    (originalUrl.split('?')[0] ?? '').toLowerCase().replace(/\/+$/, '')

/**
 * SEC-73: the demo user may read and run the read-only computations, and nothing else. Session
 * refresh and logout authenticate by cookie, not through the bearer middleware, so they are never
 * judged here. Unknown paths fail closed.
 */
export const isDemoRequestAllowed = (method: string, originalUrl: string): boolean => {
    const verb = method.toUpperCase()
    if (READ_METHODS.has(verb)) return true
    return verb === 'POST' && DEMO_READ_ONLY_POSTS.has(normalisePath(originalUrl))
}
