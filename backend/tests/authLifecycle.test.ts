import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import { User } from '@modules/users'
import { RefreshToken } from '@modules/auth'
import { createApp } from '@http/app'
import { authHeader, registerUser } from './helpers'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { hashToken } from "@modules/auth/tokenUtils";
import { createPasswordResetForUser } from "@modules/auth/passwordResetUtils";

const REFRESH_COOKIE = 'corvale_refresh'

const getSetCookieHeaders = (headers: request.Response['headers']): string[] => {
    const setCookie = headers['set-cookie']
    if (!setCookie) return []
    return Array.isArray(setCookie) ? setCookie : [setCookie]
}

const toCookieHeader = (setCookieHeader: string): string => setCookieHeader.split(';')[0]

const findRefreshCookie = (headers: request.Response['headers']): string | undefined =>
    getSetCookieHeaders(headers).find((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`))

const loginWithAgent = async (app: ReturnType<typeof createApp>, email: string, password: string) => {
    const agent = request.agent(app)
    const res = await agent.post('/api/v1/auth/login').send({ email, password })
    return { agent, res }
}

describe('Auth lifecycle', () => {
    afterEach(() => {
        process.env.VIRUS_SCAN_ENABLED = 'false'
    })

    it('issues access token and refresh cookie on login', async () => {
        const app = createApp()
        const email = 'lifecycle-login@example.com'
        const password = 'TestPassword123!'

        await User.create({ fullName: 'Lifecycle User', email, password, isEmailVerified: true })

        const { res } = await loginWithAgent(app, email, password)

        expect(res.status).toBe(200)
        expect(res.body.data.token).toBeTruthy()
        expect(res.body.data.user.email).toBe(email)

        const cookies = getSetCookieHeaders(res.headers)
        expect(cookies.some((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`))).toBe(true)

        const refreshRecords = await RefreshToken.find({
            userId: res.body.data.user._id,
            revokedAt: null,
        })
        expect(refreshRecords).toHaveLength(1)
    })

    it('rotates refresh token and returns a new access token', async () => {
        const app = createApp()
        const email = 'lifecycle-refresh@example.com'
        const password = 'TestPassword123!'

        await User.create({ fullName: 'Refresh User', email, password, isEmailVerified: true })
        const { agent, res: loginRes } = await loginWithAgent(app, email, password)

        const oldRefreshCookie = findRefreshCookie(loginRes.headers)
        expect(oldRefreshCookie).toBeTruthy()

        const refreshRes = await agent.post('/api/v1/auth/refresh')

        expect(refreshRes.status).toBe(200)
        expect(refreshRes.body.data.token).toBeTruthy()

        const cookies = getSetCookieHeaders(refreshRes.headers)
        expect(cookies.some((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`))).toBe(true)

        const reuseRes = await request(app)
            .post('/api/v1/auth/refresh')
            .set('Cookie', toCookieHeader(oldRefreshCookie!))

        expect(reuseRes.status).toBe(401)
        expect(reuseRes.body.message).toBe(ERROR_MESSAGES.AUTH.REFRESH_TOKEN_REUSED)
    })

    it('rejects a refresh token after rotation', async () => {
        const app = createApp()
        const email = 'lifecycle-rotate@example.com'
        const password = 'TestPassword123!'

        await registerUser(app, { email, password })
        const loginRes = await request(app)
            .post('/api/v1/auth/login')
            .send({ email, password })

        const oldRefreshCookie = findRefreshCookie(loginRes.headers)
        expect(oldRefreshCookie).toBeTruthy()

        const agent = request.agent(app)
        await agent.post('/api/v1/auth/refresh').set('Cookie', toCookieHeader(oldRefreshCookie!))

        const reuseRes = await request(app)
            .post('/api/v1/auth/refresh')
            .set('Cookie', toCookieHeader(oldRefreshCookie!))

        expect(reuseRes.status).toBe(401)
        expect(reuseRes.body.message).toBe(ERROR_MESSAGES.AUTH.REFRESH_TOKEN_REUSED)
    })

    it('rejects expired refresh tokens', async () => {
        const app = createApp()
        const { userId, email } = await registerUser(app, {
            email: 'lifecycle-expired-refresh@example.com',
        })

        const rawToken = 'expired-refresh-token-value'
        const tokenId = new mongoose.Types.ObjectId()
        await RefreshToken.create({
            _id: tokenId,
            userId,
            tokenHash: hashToken(rawToken),
            familyId: tokenId,
            expiresAt: new Date(Date.now() - 60_000),
        })

        const res = await request(app)
            .post('/api/v1/auth/refresh')
            .set('Cookie', `${REFRESH_COOKIE}=${rawToken}`)

        expect(res.status).toBe(401)
        expect(res.body.message).toBe(ERROR_MESSAGES.AUTH.REFRESH_TOKEN_INVALID)
    })

    it('revokes refresh token on logout', async () => {
        const app = createApp()
        const email = 'lifecycle-logout@example.com'
        const password = 'TestPassword123!'

        await User.create({ fullName: 'Logout User', email, password, isEmailVerified: true })
        const { agent, res: loginRes } = await loginWithAgent(app, email, password)

        const refreshCookie = findRefreshCookie(loginRes.headers)
        expect(refreshCookie).toBeTruthy()

        const logoutRes = await agent.post('/api/v1/auth/logout')
        expect(logoutRes.status).toBe(200)

        const refreshRes = await request(app)
            .post('/api/v1/auth/refresh')
            .set('Cookie', toCookieHeader(refreshCookie!))

        expect(refreshRes.status).toBe(401)
        expect(refreshRes.body.message).toBe(ERROR_MESSAGES.AUTH.REFRESH_TOKEN_REUSED)
    })

    it('logout-all invalidates existing access tokens via tokenVersion', async () => {
        const app = createApp()
        const email = 'lifecycle-logout-all@example.com'
        const password = 'TestPassword123!'

        const { token } = await registerUser(app, { email, password })

        const logoutAllRes = await request(app)
            .post('/api/v1/auth/logout-all')
            .set(authHeader(token))

        expect(logoutAllRes.status).toBe(200)

        const protectedRes = await request(app)
            .get('/api/v1/auth/user')
            .set(authHeader(token))

        expect(protectedRes.status).toBe(401)
        expect(protectedRes.body.message).toBe(ERROR_MESSAGES.AUTH.TOKEN_REVOKED)
    })

    it('logout-all revokes all refresh tokens for the user', async () => {
        const app = createApp()
        const email = 'lifecycle-logout-all-refresh@example.com'
        const password = 'TestPassword123!'

        const { token } = await registerUser(app, { email, password })

        const firstLogin = await request(app).post('/api/v1/auth/login').send({ email, password })
        const secondLogin = await request(app).post('/api/v1/auth/login').send({ email, password })

        const firstCookie = findRefreshCookie(firstLogin.headers)
        const secondCookie = findRefreshCookie(secondLogin.headers)

        await request(app).post('/api/v1/auth/logout-all').set(authHeader(token))

        const firstRefresh = await request(app)
            .post('/api/v1/auth/refresh')
            .set('Cookie', toCookieHeader(firstCookie!))

        const secondRefresh = await request(app)
            .post('/api/v1/auth/refresh')
            .set('Cookie', toCookieHeader(secondCookie!))

        expect(firstRefresh.status).toBe(401)
        expect(secondRefresh.status).toBe(401)
    })

    it('rejects access tokens with stale tokenVersion', async () => {
        const app = createApp()
        const { token, userId } = await registerUser(app, {
            email: 'lifecycle-stale-tv@example.com',
        })

        const staleToken = jwt.sign(
            { id: userId, tv: 0 },
            process.env.JWT_SECRET as string,
            { expiresIn: '1h' }
        )

        await User.findByIdAndUpdate(userId, { $inc: { tokenVersion: 1 } })

        const res = await request(app).get('/api/v1/auth/user').set(authHeader(staleToken))

        expect(res.status).toBe(401)
        expect(res.body.message).toBe(ERROR_MESSAGES.AUTH.TOKEN_REVOKED)
    })

    it('returns the same password reset message for unknown emails', async () => {
        const app = createApp()
        await registerUser(app, { email: 'lifecycle-reset-known@example.com' })

        const knownRes = await request(app)
            .post('/api/v1/auth/password-reset/request')
            .send({ email: 'lifecycle-reset-known@example.com' })

        const unknownRes = await request(app)
            .post('/api/v1/auth/password-reset/request')
            .send({ email: 'missing-user@example.com' })

        expect(knownRes.status).toBe(200)
        expect(unknownRes.status).toBe(200)
        expect(knownRes.body.data.message).toBe(ERROR_MESSAGES.AUTH.PASSWORD_RESET_EMAIL_SENT)
        expect(unknownRes.body.data.message).toBe(ERROR_MESSAGES.AUTH.PASSWORD_RESET_EMAIL_SENT)
    })

    it('confirms password reset and revokes existing sessions', async () => {
        const app = createApp()
        const email = 'lifecycle-reset-confirm@example.com'
        const oldPassword = 'TestPassword123!'
        const newPassword = 'NewPassword456!'

        const { token } = await registerUser(app, { email, password: oldPassword })
        const resetToken = await createPasswordResetForUser(email)
        expect(resetToken).toBeTruthy()

        const confirmRes = await request(app)
            .post('/api/v1/auth/password-reset/confirm')
            .send({ token: resetToken, password: newPassword })

        expect(confirmRes.status).toBe(200)

        const oldTokenRes = await request(app).get('/api/v1/auth/user').set(authHeader(token))
        expect(oldTokenRes.status).toBe(401)
        expect(oldTokenRes.body.message).toBe(ERROR_MESSAGES.AUTH.TOKEN_REVOKED)

        const loginRes = await request(app).post('/api/v1/auth/login').send({ email, password: newPassword })
        expect(loginRes.status).toBe(200)

        const oldLoginRes = await request(app)
            .post('/api/v1/auth/login')
            .send({ email, password: oldPassword })

        expect(oldLoginRes.status).toBe(400)
    })

    it('rejects invalid password reset tokens', async () => {
        const app = createApp()
        await registerUser(app, { email: 'lifecycle-reset-invalid@example.com' })

        const res = await request(app)
            .post('/api/v1/auth/password-reset/confirm')
            .send({ token: 'not-a-valid-reset-token', password: 'NewPassword456!' })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(ERROR_MESSAGES.AUTH.PASSWORD_RESET_INVALID)
    })

    it('rejects expired password reset tokens', async () => {
        const app = createApp()
        const email = 'lifecycle-reset-expired@example.com'
        await registerUser(app, { email })

        const rawToken = await createPasswordResetForUser(email)
        await User.findOneAndUpdate(
            { email },
            { passwordResetExpires: new Date(Date.now() - 60_000) }
        )

        const res = await request(app)
            .post('/api/v1/auth/password-reset/confirm')
            .send({ token: rawToken, password: 'NewPassword456!' })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(ERROR_MESSAGES.AUTH.PASSWORD_RESET_INVALID)
    })
})
