import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app'

/**
 * Acceptance spec for cross-origin refresh-cookie topology (S13, SEC-11).
 *
 * Today `setRefreshTokenCookie`/`clearRefreshTokenCookie` (`backend/utils/tokenUtils.ts`)
 * hardcode `sameSite: 'lax'`. That is the right choice for Corvale's pinned deployment
 * topology (frontend and API sharing a registrable domain) but breaks silently — no error,
 * just an unnoticed 15-minute logout loop — the moment someone deploys frontend and API on
 * unrelated domains (SEC-11's reported symptom).
 *
 * Contract assumed here (implemented in S13):
 *   - A new `getRefreshCookieSameSite(env)` in `backend/utils/tokenUtils.ts` reads an
 *     optional `REFRESH_COOKIE_SAME_SITE` env var, defaulting to `'lax'` — the pinned,
 *     same-site topology stays the silent default, unchanged for every existing deployment.
 *   - An explicit value must be one of `lax` | `strict` | `none`; anything else throws.
 *   - `none` (the opt-in for a genuinely cross-site deployment) is only accepted when
 *     `NODE_ENV=production`, because a `SameSite=None` cookie without `Secure` is rejected
 *     outright by browsers, and `Secure` here is only ever true in production — so an
 *     operator who sets `none` in dev/test gets a loud startup error instead of a cookie
 *     that silently never arrives.
 *   - `validateEnv` (`backend/utils/envValidation.ts`), already called at the top of
 *     `createApp()` per SEC-12, now also calls `getRefreshCookieSameSite` so a
 *     misconfigured `REFRESH_COOKIE_SAME_SITE` fails startup the same way a missing
 *     `CLIENT_URL` does, rather than surfacing as a mystery bug in production.
 *   - `setRefreshTokenCookie`/`clearRefreshTokenCookie` use `getRefreshCookieSameSite()`
 *     instead of the hardcoded literal, so a valid override actually changes the cookie's
 *     `SameSite` attribute.
 */

const getSetCookieHeaders = (headers: request.Response['headers']): string[] => {
    const setCookie = headers['set-cookie']
    if (!setCookie) return []
    return Array.isArray(setCookie) ? setCookie : [setCookie]
}

const findRefreshCookie = (headers: request.Response['headers']): string | undefined =>
    getSetCookieHeaders(headers).find((cookie) => cookie.startsWith('corvale_refresh='))

const findCookieNamed = (headers: request.Response['headers'], name: string): string | undefined =>
    getSetCookieHeaders(headers).find((cookie) => cookie.startsWith(`${name}=`))

describe('Refresh cookie deployment topology (S13, SEC-11)', () => {
    afterEach(() => {
        delete process.env.REFRESH_COOKIE_SAME_SITE
        process.env.NODE_ENV = 'test'
    })

    it('defaults to SameSite=Lax (the pinned same-site topology) when unset', async () => {
        const app = createApp()
        const res = await request(app).post('/api/v1/auth/register').send({
            acceptedTerms: true,
            ageAttested: true,
            fullName: 'Topology Default',
            email: 'topology-default@example.com',
            password: 'TestPassword123!',
        })

        const cookie = findRefreshCookie(res.headers)
        expect(cookie).toBeTruthy()
        expect((cookie as string).toLowerCase()).toContain('samesite=lax')
    })

    it('refuses to boot on an invalid REFRESH_COOKIE_SAME_SITE value', () => {
        process.env.REFRESH_COOKIE_SAME_SITE = 'sometimes'
        expect(() => createApp()).toThrow(/REFRESH_COOKIE_SAME_SITE/)
    })

    it('refuses to boot with SameSite=none outside production', () => {
        process.env.REFRESH_COOKIE_SAME_SITE = 'none'
        process.env.NODE_ENV = 'test'
        expect(() => createApp()).toThrow(/production/)
    })

    it('accepts the explicit cross-site opt-in in production', async () => {
        process.env.REFRESH_COOKIE_SAME_SITE = 'none'
        process.env.NODE_ENV = 'production'

        const app = createApp()
        const res = await request(app).post('/api/v1/auth/register').send({
            acceptedTerms: true,
            ageAttested: true,
            fullName: 'Topology Cross Site',
            email: 'topology-cross-site@example.com',
            password: 'TestPassword123!',
        })

        const cookie = findRefreshCookie(res.headers)
        expect(cookie).toBeTruthy()
        expect((cookie as string).toLowerCase()).toContain('samesite=none')
        expect((cookie as string).toLowerCase()).toContain('secure')
    })

    it('honours an explicit strict override', async () => {
        process.env.REFRESH_COOKIE_SAME_SITE = 'strict'

        const app = createApp()
        const res = await request(app).post('/api/v1/auth/register').send({
            acceptedTerms: true,
            ageAttested: true,
            fullName: 'Topology Strict',
            email: 'topology-strict@example.com',
            password: 'TestPassword123!',
        })

        const cookie = findRefreshCookie(res.headers)
        expect(cookie).toBeTruthy()
        expect((cookie as string).toLowerCase()).toContain('samesite=strict')
    })
})

/**
 * V7.3a rename-compat shim: `spndr_refresh` (the pre-rename cookie name) is replaced by
 * `corvale_refresh`, but a browser that still holds the old cookie from before the rename would
 * otherwise carry it forever - cookies aren't cleaned up by a rename alone. `clearRefreshTokenCookie`
 * must issue a one-shot `Set-Cookie: spndr_refresh=...; Expires=<past>` alongside clearing the new
 * cookie, on every path that calls it (logout, logout-all, account deletion), so a stale cookie
 * doesn't sit in every pre-rename tester's browser indefinitely (see ROADMAP's V7 compat matrix).
 */
describe('Legacy spndr_refresh cookie cleanup (V7.3a rename shim)', () => {
    it('clears the legacy spndr_refresh cookie alongside the new corvale_refresh cookie on logout', async () => {
        const app = createApp()
        const registerRes = await request(app).post('/api/v1/auth/register').send({
            acceptedTerms: true,
            ageAttested: true,
            fullName: 'Legacy Cookie Cleanup',
            email: 'legacy-cookie-cleanup@example.com',
            password: 'TestPassword123!',
        })

        const refreshCookie = findRefreshCookie(registerRes.headers)
        expect(refreshCookie).toBeTruthy()
        const cookieValue = (refreshCookie as string).split(';')[0]

        const logoutRes = await request(app).post('/api/v1/auth/logout').set('Cookie', cookieValue)

        const clearedNew = findCookieNamed(logoutRes.headers, 'corvale_refresh')
        const clearedLegacy = findCookieNamed(logoutRes.headers, 'spndr_refresh')
        expect(clearedNew).toBeTruthy()
        expect(clearedLegacy).toBeTruthy()
        // clearCookie expires immediately in the past, with no meaningful token value.
        expect((clearedNew as string).toLowerCase()).toMatch(/expires=|max-age=0/)
        expect((clearedLegacy as string).toLowerCase()).toMatch(/expires=|max-age=0/)
    })
})
