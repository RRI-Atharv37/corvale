import { describe, it, expect } from 'vitest'
import request from 'supertest'
import User from '../models/User'
import RefreshToken from '../models/RefreshToken'
import { createApp } from '../app'
import { registerUser } from './helpers'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { hashToken } from '../utils/tokenUtils'

/**
 * BUG-24 / SEC-11: the packaged desktop (Tauri) app is cross-site to `api.corvale.app`, so the
 * `SameSite=Lax` refresh cookie is never sent and the cookie-only refresh path logs the user out
 * at the access-token TTL. The desktop client is identified by its fixed `Origin` header and gets
 * the rotated refresh token in the response body (to persist in the OS keychain) instead; it may
 * present that token back in the `/auth/refresh` and `/auth/logout` request bodies. The web app
 * keeps using the httpOnly cookie unchanged.
 */

const DESKTOP_ORIGIN = 'http://tauri.localhost'
const WEB_ORIGIN = 'http://localhost:5173'

const PASSWORD = 'TestPassword123!'

const loginAsDesktop = (app: ReturnType<typeof createApp>, email: string) =>
    request(app).post('/api/v1/auth/login').set('Origin', DESKTOP_ORIGIN).send({ email, password: PASSWORD })

describe('Desktop non-cookie refresh path (BUG-24 / SEC-11)', () => {
    it('returns the refresh token in the login response body for a desktop-origin request', async () => {
        const app = createApp()
        const { email } = await registerUser(app, { email: 'desktop-login@example.com', password: PASSWORD })

        const res = await loginAsDesktop(app, email)

        expect(res.status).toBe(200)
        expect(typeof res.body.data.refreshToken).toBe('string')
        expect(res.body.data.refreshToken.length).toBeGreaterThan(0)

        // The returned token is a real, active refresh token for this user.
        const stored = await RefreshToken.findOne({ tokenHash: hashToken(res.body.data.refreshToken) })
        expect(stored?.revokedAt ?? null).toBeNull()
    })

    it('does NOT return a refresh token in the body for a web-origin login (regression)', async () => {
        const app = createApp()
        const { email } = await registerUser(app, { email: 'web-login@example.com', password: PASSWORD })

        const res = await request(app)
            .post('/api/v1/auth/login')
            .set('Origin', WEB_ORIGIN)
            .send({ email, password: PASSWORD })

        expect(res.status).toBe(200)
        expect(res.body.data.refreshToken).toBeUndefined()
        // The cookie is still set for the web client.
        const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined
        expect((setCookie ?? []).some((c) => c.startsWith('corvale_refresh='))).toBe(true)
    })

    it('also returns a refresh token in the body on register for a desktop-origin request', async () => {
        const app = createApp()
        const res = await request(app)
            .post('/api/v1/auth/register')
            .set('Origin', DESKTOP_ORIGIN)
            .send({
                fullName: 'Desktop User',
                email: 'desktop-register@example.com',
                password: PASSWORD,
                acceptedTerms: true,
                ageAttested: true,
            })

        expect(res.status).toBe(201)
        expect(typeof res.body.data.refreshToken).toBe('string')
    })

    it('refreshes from a body token with no cookie and rotates the body token', async () => {
        const app = createApp()
        const { email } = await registerUser(app, { email: 'desktop-refresh@example.com', password: PASSWORD })
        const firstToken = (await loginAsDesktop(app, email)).body.data.refreshToken as string

        const res = await request(app)
            .post('/api/v1/auth/refresh')
            .set('Origin', DESKTOP_ORIGIN)
            .send({ refreshToken: firstToken })

        expect(res.status).toBe(200)
        expect(res.body.data.token).toBeTruthy()
        expect(typeof res.body.data.refreshToken).toBe('string')
        expect(res.body.data.refreshToken).not.toBe(firstToken)
    })

    it('revokes the whole family when a rotated desktop body token is replayed', async () => {
        const app = createApp()
        const { email } = await registerUser(app, { email: 'desktop-reuse@example.com', password: PASSWORD })
        const firstToken = (await loginAsDesktop(app, email)).body.data.refreshToken as string

        await request(app)
            .post('/api/v1/auth/refresh')
            .set('Origin', DESKTOP_ORIGIN)
            .send({ refreshToken: firstToken })

        const replay = await request(app)
            .post('/api/v1/auth/refresh')
            .set('Origin', DESKTOP_ORIGIN)
            .send({ refreshToken: firstToken })

        expect(replay.status).toBe(401)
        expect(replay.body.message).toBe(ERROR_MESSAGES.AUTH.REFRESH_TOKEN_REUSED)
    })

    it('401s a desktop refresh with neither a body token nor a cookie', async () => {
        const app = createApp()
        const res = await request(app).post('/api/v1/auth/refresh').set('Origin', DESKTOP_ORIGIN).send({})

        expect(res.status).toBe(401)
        expect(res.body.message).toBe(ERROR_MESSAGES.AUTH.REFRESH_TOKEN_MISSING)
    })

    it('accepts a body token from a non-desktop origin but does not echo one back', async () => {
        const app = createApp()
        const { email } = await registerUser(app, { email: 'body-token-web@example.com', password: PASSWORD })
        // Get a raw token via a desktop login, then present it from a web-origin refresh.
        const token = (await loginAsDesktop(app, email)).body.data.refreshToken as string

        const res = await request(app)
            .post('/api/v1/auth/refresh')
            .set('Origin', WEB_ORIGIN)
            .send({ refreshToken: token })

        expect(res.status).toBe(200)
        expect(res.body.data.token).toBeTruthy()
        expect(res.body.data.refreshToken).toBeUndefined()
    })

    it('revokes a desktop body token on logout', async () => {
        const app = createApp()
        const { email } = await registerUser(app, { email: 'desktop-logout@example.com', password: PASSWORD })
        const loginRes = await loginAsDesktop(app, email)
        const token = loginRes.body.data.refreshToken as string
        const accessToken = loginRes.body.data.token as string

        const logoutRes = await request(app)
            .post('/api/v1/auth/logout')
            .set('Origin', DESKTOP_ORIGIN)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ refreshToken: token })

        expect(logoutRes.status).toBe(200)

        const stored = await RefreshToken.findOne({ tokenHash: hashToken(token) })
        expect(stored?.revokedAt).toBeTruthy()

        // And it can no longer be used to refresh.
        const refreshRes = await request(app)
            .post('/api/v1/auth/refresh')
            .set('Origin', DESKTOP_ORIGIN)
            .send({ refreshToken: token })
        expect(refreshRes.status).toBe(401)
    })

    it('leaves the cookie-only web refresh flow working (regression)', async () => {
        const app = createApp()
        const { email } = await registerUser(app, { email: 'web-cookie-refresh@example.com', password: PASSWORD })
        const agent = request.agent(app)
        await agent.post('/api/v1/auth/login').set('Origin', WEB_ORIGIN).send({ email, password: PASSWORD })

        const res = await agent.post('/api/v1/auth/refresh').set('Origin', WEB_ORIGIN)

        expect(res.status).toBe(200)
        expect(res.body.data.token).toBeTruthy()
        expect(res.body.data.refreshToken).toBeUndefined()
    })

    it('keeps User lookups scoped - a desktop refresh for a deleted user 401s', async () => {
        const app = createApp()
        const { email, userId } = await registerUser(app, { email: 'desktop-gone@example.com', password: PASSWORD })
        const token = (await loginAsDesktop(app, email)).body.data.refreshToken as string
        await User.findByIdAndDelete(userId)

        const res = await request(app)
            .post('/api/v1/auth/refresh')
            .set('Origin', DESKTOP_ORIGIN)
            .send({ refreshToken: token })

        expect(res.status).toBe(401)
    })
})
