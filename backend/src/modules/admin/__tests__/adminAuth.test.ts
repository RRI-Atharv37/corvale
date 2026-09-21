import request from 'supertest'
import type { Application } from 'express'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import defaultApp from '@http/app'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { authHeader, registerUser } from '@tests/helpers'
import {
    ADMIN_BASE,
    ADMIN_COOKIE,
    bearer,
    buildAdminApp,
    clearTotpReplay,
    disableAdmin,
    loginAsAdmin,
    postLogin,
    seedAdmin,
    signAdminToken,
    MINUTE_MS,
    HOUR_MS,
} from '@tests/adminHelpers'
import { AdminAuditLog, AdminSession, AdminUser } from '@modules/admin'

/**
 * M7.1 - admin authentication. Password + mandatory TOTP in one step; a separate secret, audience and
 * issuer from the user API; server-side revocable sessions with idle and absolute limits; step-up.
 */

const ME = `${ADMIN_BASE}/auth/me`
const INVITE = `${ADMIN_BASE}/admins/invite`

let app: Application

beforeAll(() => {
    app = buildAdminApp()
})

afterAll(() => {
    disableAdmin()
})

describe('POST /admin/auth/login', () => {
    it('signs in with password + TOTP and returns an access token without any secret material', async () => {
        const admin = await seedAdmin({ role: 'support' })

        const res = await postLogin(app, admin)

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(typeof res.body.data.accessToken).toBe('string')
        expect(res.body.data.admin).toEqual({ id: admin.id, email: admin.email, role: 'support' })
        const raw = JSON.stringify(res.body)
        expect(raw).not.toContain('passwordHash')
        expect(raw).not.toContain(admin.secret)
        expect(raw).not.toContain('totpSecret')
    })

    it('sets a refresh cookie that is httpOnly, SameSite=Strict and scoped to the admin auth path', async () => {
        const admin = await seedAdmin()

        const res = await postLogin(app, admin)
        const cookie = ([] as string[]).concat(res.headers['set-cookie']).find((c) => c.startsWith(`${ADMIN_COOKIE}=`))

        expect(cookie).toBeDefined()
        expect(cookie).toMatch(/HttpOnly/i)
        expect(cookie).toMatch(/SameSite=Strict/i)
        expect(cookie).toContain('Path=/api/v1/admin/auth')
    })

    it('refuses a wrong password, a wrong TOTP and an unknown email with the same response', async () => {
        const admin = await seedAdmin()

        const wrongPassword = await postLogin(app, admin, { password: 'not the password at all' })
        const wrongTotp = await postLogin(app, admin, { totpCode: '000000' })
        const unknown = await postLogin(app, admin, { email: 'nobody@ops.example.com' })

        for (const res of [wrongPassword, wrongTotp, unknown]) {
            expect(res.status).toBe(401)
            expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.INVALID_CREDENTIALS)
        }
    })

    it('never signs in with a password alone', async () => {
        const admin = await seedAdmin()

        const res = await request(app)
            .post(`${ADMIN_BASE}/auth/login`)
            .send({ email: admin.email, password: admin.password })

        expect(res.status).toBe(401)
    })

    it('refuses pending, re-enrolment and disabled accounts as if the credentials were wrong', async () => {
        for (const status of ['pending', 'reenrol', 'disabled'] as const) {
            const admin = await seedAdmin({ status })

            const res = await postLogin(app, admin)

            expect(res.status).toBe(401)
            expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.INVALID_CREDENTIALS)
        }
    })

    it('rejects a TOTP code that was already used (replay), even with the right password', async () => {
        const admin = await seedAdmin()
        const code = admin.code()

        expect((await postLogin(app, admin, { totpCode: code })).status).toBe(200)
        const replay = await postLogin(app, admin, { totpCode: code })

        expect(replay.status).toBe(401)
    })

    it('accepts a later step after an earlier one was used', async () => {
        const admin = await seedAdmin()

        expect((await postLogin(app, admin, { totpCode: admin.code() })).status).toBe(200)
        expect((await postLogin(app, admin, { totpCode: admin.code(30) })).status).toBe(200)
    })

    it('accepts a recovery code once and then refuses it', async () => {
        const admin = await seedAdmin()
        const [recovery] = admin.recoveryCodes

        const first = await request(app)
            .post(`${ADMIN_BASE}/auth/login`)
            .send({ email: admin.email, password: admin.password, recoveryCode: recovery.toUpperCase() })
        const second = await request(app)
            .post(`${ADMIN_BASE}/auth/login`)
            .send({ email: admin.email, password: admin.password, recoveryCode: recovery })

        expect(first.status).toBe(200)
        expect(second.status).toBe(401)
        expect((await AdminUser.findById(admin.id))?.recoveryCodeHashes).toHaveLength(9)
    })

    it('a recovery-code login does not open the step-up window', async () => {
        const admin = await seedAdmin()
        const res = await request(app)
            .post(`${ADMIN_BASE}/auth/login`)
            .send({ email: admin.email, password: admin.password, recoveryCode: admin.recoveryCodes[0] })

        const probe = await request(app).post(INVITE).set(bearer(res.body.data.accessToken)).send({})

        expect(probe.status).toBe(403)
        expect(probe.body.message).toBe(ERROR_MESSAGES.ADMIN.STEP_UP_REQUIRED)
    })

    it('locks the account after five failures, even against the correct credentials, and audits it', async () => {
        const admin = await seedAdmin()

        for (let i = 0; i < 5; i += 1) {
            expect((await postLogin(app, admin, { totpCode: '000000' })).status).toBe(401)
        }
        const locked = await postLogin(app, admin)

        expect(locked.status).toBe(429)
        expect(locked.body.message).toBe(ERROR_MESSAGES.ADMIN.LOCKED)
        expect(await AdminAuditLog.countDocuments({ action: 'admin.login_failed', adminId: admin.id })).toBe(5)
        expect(await AdminAuditLog.countDocuments({ action: 'admin.lockout', adminId: admin.id })).toBe(1)
    })

    it('lets the account back in once the lockout has passed and resets the counter', async () => {
        const admin = await seedAdmin()
        for (let i = 0; i < 5; i += 1) await postLogin(app, admin, { totpCode: '000000' })
        await AdminUser.updateOne({ _id: admin.id }, { $set: { lockedUntil: new Date(Date.now() - 1000) } })

        const res = await postLogin(app, admin)

        expect(res.status).toBe(200)
        expect((await AdminUser.findById(admin.id))?.failedLoginCount).toBe(0)
    })

    it('audits a successful login with the admin and ip, and never the email', async () => {
        const admin = await seedAdmin()

        await postLogin(app, admin)

        const row = await AdminAuditLog.findOne({ action: 'admin.login' }).lean()
        expect(row?.adminId?.toString()).toBe(admin.id)
        expect(row?.adminRole).toBe('owner')
        expect(row?.ip).toBeTruthy()
        expect(JSON.stringify(row)).not.toContain(admin.email)
    })

    it('does not store the attempted email when an unknown address fails', async () => {
        const admin = await seedAdmin()

        await postLogin(app, admin, { email: 'probe@ops.example.com' })

        const row = await AdminAuditLog.findOne({ action: 'admin.login_failed' }).lean()
        expect(row?.adminId ?? null).toBeNull()
        expect(JSON.stringify(row)).not.toContain('probe@ops.example.com')
    })
})

describe('token separation between the user API and the admin API', () => {
    it('a user access token is refused on admin routes', async () => {
        const user = await registerUser(defaultApp)

        const res = await request(app).get(ME).set(authHeader(user.token))

        expect(res.status).toBe(401)
    })

    it('an admin access token is refused on user routes', async () => {
        const admin = await seedAdmin()
        const { token } = await loginAsAdmin(app, admin)

        const res = await request(defaultApp).get('/api/v1/auth/user').set(authHeader(token))

        expect(res.status).toBe(401)
    })

    it('refuses a token signed with the user secret even if it claims the admin audience', async () => {
        const admin = await seedAdmin()
        const forged = signAdminToken({ sub: admin.id, sid: '000000000000000000000000' }, { secret: process.env.JWT_SECRET })

        expect((await request(app).get(ME).set(bearer(forged))).status).toBe(401)
    })

    it.each([
        ['audience', { audience: 'corvale' }],
        ['issuer', { issuer: 'someone-else' }],
    ])('refuses an admin-signed token with the wrong %s', async (_name, override) => {
        const admin = await seedAdmin()
        const { token } = await loginAsAdmin(app, admin)
        const session = await AdminSession.findOne({ adminId: admin.id })
        const wrong = signAdminToken({ sub: admin.id, sid: session?._id.toString(), role: 'owner' }, override)

        expect((await request(app).get(ME).set(bearer(token))).status).toBe(200)
        expect((await request(app).get(ME).set(bearer(wrong))).status).toBe(401)
    })

    it('refuses an unsigned (alg: none) token', async () => {
        const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
        const body = Buffer.from(JSON.stringify({ sub: 'x', aud: 'corvale-admin', iss: 'corvale-admin' })).toString('base64url')

        expect((await request(app).get(ME).set(bearer(`${header}.${body}.`))).status).toBe(401)
    })

    it('refuses a missing or malformed Authorization header', async () => {
        expect((await request(app).get(ME)).status).toBe(401)
        expect((await request(app).get(ME).set('Authorization', 'Token abc')).status).toBe(401)
    })
})

describe('admin sessions', () => {
    let admin: Awaited<ReturnType<typeof seedAdmin>>
    let token: string
    let cookie: string

    beforeEach(async () => {
        admin = await seedAdmin({ role: 'support' })
        ;({ token, cookie } = await loginAsAdmin(app, admin))
    })

    it('GET /me returns the admin, the session limits and the role capabilities', async () => {
        const res = await request(app).get(ME).set(bearer(token))

        expect(res.status).toBe(200)
        expect(res.body.data.admin).toEqual({ id: admin.id, email: admin.email, role: 'support' })
        expect(res.body.data.capabilities).toContain('subscribers.read')
        expect(res.body.data.capabilities).not.toContain('admins.manage')
        expect(res.body.data.session.expiresAt).toBeTruthy()
    })

    it('refuses a revoked session', async () => {
        await AdminSession.updateMany({ adminId: admin.id }, { $set: { revokedAt: new Date() } })

        expect((await request(app).get(ME).set(bearer(token))).status).toBe(401)
    })

    it('refuses a disabled admin even with a live session', async () => {
        await AdminUser.updateOne({ _id: admin.id }, { $set: { status: 'disabled' } })

        expect((await request(app).get(ME).set(bearer(token))).status).toBe(401)
    })

    it('ends a session that has been idle for 30 minutes', async () => {
        await AdminSession.updateMany({ adminId: admin.id }, { $set: { lastActivityAt: new Date(Date.now() - 31 * MINUTE_MS) } })

        expect((await request(app).get(ME).set(bearer(token))).status).toBe(401)
    })

    it('ends a session after eight hours no matter how active it is', async () => {
        await AdminSession.updateMany({ adminId: admin.id }, { $set: { absoluteExpiresAt: new Date(Date.now() - 1000) } })

        expect((await request(app).get(ME).set(bearer(token))).status).toBe(401)
        expect((await request(app).post(`${ADMIN_BASE}/auth/refresh`).set('Cookie', cookie)).status).toBe(401)
    })

    it('rotates the refresh token, and replaying the old one revokes the session', async () => {
        const first = await request(app).post(`${ADMIN_BASE}/auth/refresh`).set('Cookie', cookie)
        expect(first.status).toBe(200)
        const rotated = ([] as string[])
            .concat(first.headers['set-cookie'])
            .find((c) => c.startsWith(`${ADMIN_COOKIE}=`))!
            .split(';')[0]
        expect(rotated).not.toBe(cookie)

        const replay = await request(app).post(`${ADMIN_BASE}/auth/refresh`).set('Cookie', cookie)
        const afterReplay = await request(app).post(`${ADMIN_BASE}/auth/refresh`).set('Cookie', rotated)

        expect(replay.status).toBe(401)
        expect(afterReplay.status).toBe(401)
        expect(await AdminSession.countDocuments({ adminId: admin.id, revokedAt: null })).toBe(0)
    })

    it('a refresh returns a working access token', async () => {
        const res = await request(app).post(`${ADMIN_BASE}/auth/refresh`).set('Cookie', cookie)

        expect((await request(app).get(ME).set(bearer(res.body.data.accessToken))).status).toBe(200)
    })

    it('refuses a refresh without a cookie and never accepts the token from the body', async () => {
        expect((await request(app).post(`${ADMIN_BASE}/auth/refresh`)).status).toBe(401)
        const refreshValue = cookie.split('=')[1]
        expect((await request(app).post(`${ADMIN_BASE}/auth/refresh`).send({ refreshToken: refreshValue })).status).toBe(401)
    })

    it('refuses a refresh after 30 idle minutes', async () => {
        await AdminSession.updateMany({ adminId: admin.id }, { $set: { lastActivityAt: new Date(Date.now() - 31 * MINUTE_MS) } })

        expect((await request(app).post(`${ADMIN_BASE}/auth/refresh`).set('Cookie', cookie)).status).toBe(401)
    })

    it('logout revokes the session server-side and clears the cookie', async () => {
        const res = await request(app).post(`${ADMIN_BASE}/auth/logout`).set(bearer(token)).set('Cookie', cookie)

        expect(res.status).toBe(200)
        expect(([] as string[]).concat(res.headers['set-cookie']).join(';')).toContain(`${ADMIN_COOKIE}=;`)
        expect((await request(app).get(ME).set(bearer(token))).status).toBe(401)
        expect((await request(app).post(`${ADMIN_BASE}/auth/refresh`).set('Cookie', cookie)).status).toBe(401)
    })

    it('logout works from the refresh cookie alone', async () => {
        const res = await request(app).post(`${ADMIN_BASE}/auth/logout`).set('Cookie', cookie)

        expect(res.status).toBe(200)
        expect(await AdminSession.countDocuments({ adminId: admin.id, revokedAt: null })).toBe(0)
    })
})

describe('step-up', () => {
    let admin: Awaited<ReturnType<typeof seedAdmin>>
    let token: string

    beforeEach(async () => {
        admin = await seedAdmin({ role: 'owner' })
        ;({ token } = await loginAsAdmin(app, admin))
        await AdminSession.updateMany({ adminId: admin.id }, { $set: { stepUpAt: null } })
    })

    it('a step-up action is refused until the admin re-confirms with a fresh code', async () => {
        const res = await request(app).post(INVITE).set(bearer(token)).send({})

        expect(res.status).toBe(403)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.STEP_UP_REQUIRED)
    })

    it('POST /auth/step-up with the next TOTP step opens a five-minute window', async () => {
        const res = await request(app).post(`${ADMIN_BASE}/auth/step-up`).set(bearer(token)).send({ totpCode: admin.code(30) })

        expect(res.status).toBe(200)
        expect(new Date(res.body.data.stepUpUntil).getTime() - Date.now()).toBeGreaterThan(4 * MINUTE_MS)
        const probe = await request(app).post(INVITE).set(bearer(token)).send({})
        expect(probe.body.message).not.toBe(ERROR_MESSAGES.ADMIN.STEP_UP_REQUIRED)
    })

    it('refuses a step-up with a wrong code and audits the failure', async () => {
        const res = await request(app).post(`${ADMIN_BASE}/auth/step-up`).set(bearer(token)).send({ totpCode: '000000' })

        expect(res.status).toBe(401)
        expect(await AdminAuditLog.countDocuments({ action: 'admin.stepup_failed', adminId: admin.id })).toBe(1)
    })

    it('refuses to reuse the code the login already spent', async () => {
        const res = await request(app).post(`${ADMIN_BASE}/auth/step-up`).set(bearer(token)).send({ totpCode: admin.code() })

        expect(res.status).toBe(401)
    })

    it('a login with a TOTP code counts as a step-up', async () => {
        await clearTotpReplay(admin.id)
        const fresh = await loginAsAdmin(app, admin)

        const probe = await request(app).post(INVITE).set(bearer(fresh.token)).send({})

        expect(probe.body.message).not.toBe(ERROR_MESSAGES.ADMIN.STEP_UP_REQUIRED)
    })

    it('the window closes after five minutes', async () => {
        await AdminSession.updateMany({ adminId: admin.id }, { $set: { stepUpAt: new Date(Date.now() - 6 * MINUTE_MS) } })

        const res = await request(app).post(INVITE).set(bearer(token)).send({})

        expect(res.status).toBe(403)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.STEP_UP_REQUIRED)
    })

    it('is disabled for 24 hours after a re-enrolment', async () => {
        await AdminUser.updateOne({ _id: admin.id }, { $set: { moneyBlockedUntil: new Date(Date.now() + HOUR_MS) } })

        const stepUp = await request(app).post(`${ADMIN_BASE}/auth/step-up`).set(bearer(token)).send({ totpCode: admin.code(30) })
        await AdminSession.updateMany({ adminId: admin.id }, { $set: { stepUpAt: new Date() } })
        const probe = await request(app).post(INVITE).set(bearer(token)).send({})

        expect(stepUp.status).toBe(403)
        expect(stepUp.body.message).toBe(ERROR_MESSAGES.ADMIN.STEP_UP_DISABLED)
        expect(probe.status).toBe(403)
        expect(probe.body.message).toBe(ERROR_MESSAGES.ADMIN.STEP_UP_DISABLED)
    })
})

describe('rate limiting', () => {
    it('meters login attempts per address + email', async () => {
        const limited = buildAdminApp({ ADMIN_LOGIN_RATE_LIMIT_MAX: '3' })
        const admin = await seedAdmin()

        const statuses: number[] = []
        for (let i = 0; i < 5; i += 1) {
            statuses.push((await postLogin(limited, admin, { totpCode: '000000' })).status)
        }

        expect(statuses.slice(0, 3)).toEqual([401, 401, 401])
        expect(statuses.slice(3)).toEqual([429, 429])
        buildAdminApp()
    })
})
