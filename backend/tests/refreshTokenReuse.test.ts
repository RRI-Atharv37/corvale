import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../app'
import User from '../models/User'
import RefreshToken from '../models/RefreshToken'
import { authHeader, registerUser } from './helpers'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

/**
 * Acceptance spec for refresh-token reuse detection (S11, SEC-20).
 *
 * Today `rotateRefreshToken` (`backend/utils/refreshTokenService.ts`) rotates correctly on a
 * fresh token but treats replay of an already-rotated (revoked) token exactly like any other
 * invalid token — a single `REFRESH_TOKEN_INVALID` 401, nothing more. SEC-20's fix is reuse
 * *detection*: presenting a token that has already been rotated away is a strong signal that
 * either the legitimate device or an attacker is holding a stolen copy, and the standard
 * response is to revoke every token descended from that same login, not just the one replayed.
 *
 * Contract assumed here (implemented in S11):
 *   - `RefreshToken` gains a required, indexed `familyId: Types.ObjectId`. A fresh login/register
 *     starts a new family (`familyId` defaults to the new document's own `_id` when none is
 *     passed to `createRefreshToken`). Rotation carries the same `familyId` forward onto the
 *     replacement token, so every token issued from one login lineage shares one `familyId`.
 *   - `rotateRefreshToken` first looks up the token by hash *regardless* of `revokedAt`/
 *     `expiresAt` (today's `findValidRefreshToken` filters those out, which is exactly why reuse
 *     is indistinguishable from "never existed"). Three outcomes:
 *       1. No record at all -> `REFRESH_TOKEN_INVALID` (401), unchanged from today.
 *       2. Record found, `expiresAt` in the past, `revokedAt` still null -> `REFRESH_TOKEN_INVALID`
 *          (401), unchanged from today — a plain expiry, not a reuse signal.
 *       3. Record found with `revokedAt` already set -> **reuse detected**: every unrevoked
 *          token sharing that `familyId` is revoked, the owning `User.tokenVersion` is
 *          incremented (invalidating every outstanding access token immediately, the same
 *          mechanism logout-all already uses), and the request is rejected with a *distinct*
 *          message from plain invalidity so the client can show a "you were signed out for
 *          security" notice instead of a generic session-expired one.
 *   - Reuse detection is scoped to the replayed token's own family. A second, independent login
 *     (a different device/browser) is a different family and is not revoked by a replay on the
 *     first — consistent with `SEC-20`'s recommendation, which calls for revoking "the whole
 *     family", not every session the user has.
 *
 * The exact new error message text is intentionally not asserted against a named
 * `ERROR_MESSAGES` key (it doesn't exist yet) — assertions below check status codes and that the
 * message is *not* the plain `REFRESH_TOKEN_INVALID` string, so this spec doesn't lock in a
 * specific key name the implementation is free to choose.
 */

const REFRESH_COOKIE = 'corvale_refresh'

const getSetCookieHeaders = (headers: request.Response['headers']): string[] => {
    const setCookie = headers['set-cookie']
    if (!setCookie) return []
    return Array.isArray(setCookie) ? setCookie : [setCookie]
}

const toCookieHeader = (setCookieHeader: string): string => setCookieHeader.split(';')[0]

const findRefreshCookie = (headers: request.Response['headers']): string | undefined =>
    getSetCookieHeaders(headers).find((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`))

describe('Refresh token family lineage (S11)', () => {
    it('assigns a familyId to a freshly issued refresh token', async () => {
        const app = createApp()
        const { userId } = await registerUser(app, { email: 'family-issue@example.com' })

        const records = await RefreshToken.find({ userId })
        expect(records).toHaveLength(1)
        expect(records[0].get('familyId')).toBeTruthy()
    })

    it('carries the same familyId forward across a normal rotation', async () => {
        const app = createApp()
        const email = 'family-rotate@example.com'
        const password = 'TestPassword123!'
        await registerUser(app, { email, password })

        const agent = request.agent(app)
        const loginRes = await agent.post('/api/v1/auth/login').send({ email, password })
        const initial = await RefreshToken.find({ userId: loginRes.body.data.user._id })
        const originalFamilyId = initial.find((r) => !r.revokedAt)?.get('familyId')

        await agent.post('/api/v1/auth/refresh')

        const afterRotation = await RefreshToken.find({ userId: loginRes.body.data.user._id })
        const activeRecord = afterRotation.find((r) => !r.revokedAt)
        expect(activeRecord?.get('familyId')?.toString()).toBe(originalFamilyId?.toString())
    })
})

describe('Refresh token reuse detection (S11, SEC-20)', () => {
    it('revokes the entire family when an already-rotated refresh token is replayed', async () => {
        const app = createApp()
        const email = 'reuse-family@example.com'
        const password = 'TestPassword123!'
        await registerUser(app, { email, password })

        const agent = request.agent(app)
        const loginRes = await agent.post('/api/v1/auth/login').send({ email, password })
        const staleCookie = findRefreshCookie(loginRes.headers)
        expect(staleCookie).toBeTruthy()

        // Rotate once via the agent (which carries the cookie jar forward) so the server now
        // holds a *newer*, still-valid refresh token descended from the same family as staleCookie.
        const rotateRes = await agent.post('/api/v1/auth/refresh')
        expect(rotateRes.status).toBe(200)
        const currentCookie = findRefreshCookie(rotateRes.headers)
        expect(currentCookie).toBeTruthy()

        // Replay the stale (already-rotated) cookie - this is the reuse signal.
        const reuseRes = await request(app).post('/api/v1/auth/refresh').set('Cookie', toCookieHeader(staleCookie!))

        expect(reuseRes.status).toBe(401)
        expect(reuseRes.body.message).not.toBe(ERROR_MESSAGES.AUTH.REFRESH_TOKEN_INVALID)

        // The family's current (never-reused) token must now be dead too, not just the replayed one.
        const followUpRes = await request(app)
            .post('/api/v1/auth/refresh')
            .set('Cookie', toCookieHeader(currentCookie!))

        expect(followUpRes.status).toBe(401)
    })

    it('bumps tokenVersion on reuse so outstanding access tokens are invalidated immediately', async () => {
        const app = createApp()
        const email = 'reuse-tokenversion@example.com'
        const password = 'TestPassword123!'
        const { token: originalAccessToken } = await registerUser(app, { email, password })

        const agent = request.agent(app)
        const loginRes = await agent.post('/api/v1/auth/login').send({ email, password })
        const staleCookie = findRefreshCookie(loginRes.headers)

        await agent.post('/api/v1/auth/refresh')
        await request(app).post('/api/v1/auth/refresh').set('Cookie', toCookieHeader(staleCookie!))

        const protectedRes = await request(app).get('/api/v1/auth/user').set(authHeader(originalAccessToken))

        expect(protectedRes.status).toBe(401)
        expect(protectedRes.body.message).toBe(ERROR_MESSAGES.AUTH.TOKEN_REVOKED)
    })

    it('does not revoke an unrelated login family when a different family is replayed', async () => {
        const app = createApp()
        const email = 'reuse-scoped@example.com'
        const password = 'TestPassword123!'
        await registerUser(app, { email, password })

        // Family A: rotate once, then replay the stale cookie to trigger reuse detection.
        const agentA = request.agent(app)
        const loginA = await agentA.post('/api/v1/auth/login').send({ email, password })
        const staleA = findRefreshCookie(loginA.headers)
        await agentA.post('/api/v1/auth/refresh')
        await request(app).post('/api/v1/auth/refresh').set('Cookie', toCookieHeader(staleA!))

        // Family B: an independent, never-replayed login (a second device/browser).
        const agentB = request.agent(app)
        const loginB = await agentB.post('/api/v1/auth/login').send({ email, password })
        const cookieB = findRefreshCookie(loginB.headers)
        expect(cookieB).toBeTruthy()

        const refreshB = await request(app).post('/api/v1/auth/refresh').set('Cookie', toCookieHeader(cookieB!))

        // Family B's refresh token itself was never touched by A's incident, so it still rotates
        // successfully - it hands back a *current* access token reflecting the bumped
        // tokenVersion, which is how an uncompromised session self-heals after a sibling family
        // is revoked, rather than being logged out outright.
        expect(refreshB.status).toBe(200)
        expect(refreshB.body.data.token).toBeTruthy()

        const stillWorks = await request(app).get('/api/v1/auth/user').set(authHeader(refreshB.body.data.token))
        expect(stillWorks.status).toBe(200)
    })

    it('a fresh login after a reuse incident starts a clean, working family', async () => {
        const app = createApp()
        const email = 'reuse-recover@example.com'
        const password = 'TestPassword123!'
        await registerUser(app, { email, password })

        const agent = request.agent(app)
        const loginRes = await agent.post('/api/v1/auth/login').send({ email, password })
        const staleCookie = findRefreshCookie(loginRes.headers)
        await agent.post('/api/v1/auth/refresh')
        await request(app).post('/api/v1/auth/refresh').set('Cookie', toCookieHeader(staleCookie!))

        const freshLogin = await request(app).post('/api/v1/auth/login').send({ email, password })
        expect(freshLogin.status).toBe(200)

        const freshProtected = await request(app)
            .get('/api/v1/auth/user')
            .set(authHeader(freshLogin.body.data.token))
        expect(freshProtected.status).toBe(200)
    })

    it('SEC-64: two concurrent rotations of the same token cannot both succeed, and the race trips reuse detection', async () => {
        const app = createApp()
        const email = 'sec64-race@example.com'
        const password = 'TestPassword123!'
        await registerUser(app, { email, password })

        const agent = request.agent(app)
        const loginRes = await agent.post('/api/v1/auth/login').send({ email, password })
        const userId = loginRes.body.data.user._id
        const cookie = toCookieHeader(findRefreshCookie(loginRes.headers)!)

        const versionBefore = (await User.findById(userId))!.tokenVersion

        const [a, b] = await Promise.all([
            request(app).post('/api/v1/auth/refresh').set('Cookie', cookie),
            request(app).post('/api/v1/auth/refresh').set('Cookie', cookie),
        ])

        // The atomic claim guarantees exactly one caller consumes the token.
        expect([a.status, b.status].sort()).toEqual([200, 401])

        // The loser is the reuse it is: distinct message, family-wide revocation, tokenVersion bump.
        const loser = a.status === 401 ? a : b
        expect(loser.body.message).not.toBe(ERROR_MESSAGES.AUTH.REFRESH_TOKEN_INVALID)
        expect((await User.findById(userId))!.tokenVersion).toBeGreaterThan(versionBefore)

        // The token both requests presented is spent — replaying it is now a plain reuse.
        const stale = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie)
        expect(stale.status).toBe(401)
    })

    it('still rejects a genuinely unknown refresh token with the existing invalid-token message', async () => {
        const app = createApp()
        const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', `${REFRESH_COOKIE}=never-issued`)

        expect(res.status).toBe(401)
        expect(res.body.message).toBe(ERROR_MESSAGES.AUTH.REFRESH_TOKEN_INVALID)
    })
})

describe('Refresh token reuse regression: User.tokenVersion field still present', () => {
    it('sanity check - registering a user still starts tokenVersion at 0', async () => {
        const app = createApp()
        const { userId } = await registerUser(app, { email: 'reuse-sanity@example.com' })
        const user = await User.findById(userId)
        expect(user?.tokenVersion).toBe(0)
    })
})
