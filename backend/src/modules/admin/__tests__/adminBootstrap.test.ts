import bcrypt from 'bcryptjs'
import request from 'supertest'
import type { Application } from 'express'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { sha256Hex } from '@core/auth/tokenHash'
import { generateTotpCode } from '@core/auth/totp'
import { openSecret, parseEncryptionKey } from '@core/auth/secretBox'
import { setMailTransport, type MailMessage } from '@infra/mail/mailService'
import {
    ADMIN_BASE,
    ADMIN_PASSWORD,
    ADMIN_TOTP_KEY_HEX,
    BOOTSTRAP_SECRET,
    BREAKGLASS_SECRET,
    HOUR_MS,
    buildAdminApp,
    disableAdmin,
    enableAdmin,
    loginAsAdmin,
    postLogin,
    seedAdmin,
} from '@tests/adminHelpers'
import { AdminAuditLog, AdminSession, AdminSystem, AdminUser, breakGlass, createBootstrapOwner } from '@modules/admin'

/**
 * M7.1 - bootstrap and recovery are explicit and non-silent (plan §2.1). Neither script can create a
 * session or set a factor for someone; both only ever hand out a single-use enrolment token.
 */

let app: Application
let sent: MailMessage[]

beforeAll(() => {
    app = buildAdminApp()
})

afterAll(() => {
    disableAdmin()
})

beforeEach(() => {
    enableAdmin()
    sent = []
    setMailTransport({
        sendMail: async (message) => {
            sent.push(message)
            return { messageId: 'test' }
        },
    })
})

afterEach(() => {
    setMailTransport(null)
})

describe('createBootstrapOwner', () => {
    it('creates one pending owner with no usable password and returns a single-use enrolment token', async () => {
        const result = await createBootstrapOwner({ email: 'Founder@Ops.example.com', secret: BOOTSTRAP_SECRET })

        const admin = await AdminUser.findById(result.adminId)
        expect(admin?.email).toBe('founder@ops.example.com')
        expect(admin?.role).toBe('owner')
        expect(admin?.status).toBe('pending')
        expect(admin?.passwordHash ?? null).toBeNull()
        expect(admin?.totpSecretEnc ?? null).toBeNull()
        expect(result.enrolmentToken.length).toBeGreaterThanOrEqual(43)
        expect(admin?.enrolmentTokenHash).toBe(sha256Hex(result.enrolmentToken))
        expect(JSON.stringify(admin?.toObject())).not.toContain(result.enrolmentToken)
        expect(result.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000)
    })

    it('records that the bootstrap has been consumed and audits it as a system action', async () => {
        await createBootstrapOwner({ email: 'founder@ops.example.com', secret: BOOTSTRAP_SECRET })

        expect((await AdminSystem.findOne({ key: 'system' }))?.bootstrapConsumedAt).toBeInstanceOf(Date)
        const row = await AdminAuditLog.findOne({ action: 'admin.bootstrap' }).lean()
        expect(row?.actorType).toBe('system')
        expect(row?.adminId ?? null).toBeNull()
    })

    it('refuses without the secret, with the wrong secret, or with one that is too short', async () => {
        await expect(createBootstrapOwner({ email: 'a@ops.example.com', secret: '' })).rejects.toThrow(
            ERROR_MESSAGES.ADMIN.BOOTSTRAP_SECRET_INVALID
        )
        await expect(createBootstrapOwner({ email: 'a@ops.example.com', secret: `${BOOTSTRAP_SECRET}x` })).rejects.toThrow(
            ERROR_MESSAGES.ADMIN.BOOTSTRAP_SECRET_INVALID
        )
        process.env.ADMIN_BOOTSTRAP_SECRET_SHA256 = sha256Hex('short')
        await expect(createBootstrapOwner({ email: 'a@ops.example.com', secret: 'short' })).rejects.toThrow(
            ERROR_MESSAGES.ADMIN.BOOTSTRAP_SECRET_INVALID
        )
        expect(await AdminUser.countDocuments()).toBe(0)
    })

    it('refuses when no bootstrap secret hash is configured', async () => {
        delete process.env.ADMIN_BOOTSTRAP_SECRET_SHA256

        await expect(createBootstrapOwner({ email: 'a@ops.example.com', secret: BOOTSTRAP_SECRET })).rejects.toThrow(
            ERROR_MESSAGES.ADMIN.BOOTSTRAP_SECRET_INVALID
        )
    })

    it('refuses when any admin already exists', async () => {
        await seedAdmin({ role: 'support' })

        await expect(createBootstrapOwner({ email: 'a@ops.example.com', secret: BOOTSTRAP_SECRET })).rejects.toThrow(
            ERROR_MESSAGES.ADMIN.BOOTSTRAP_ALREADY_DONE
        )
    })

    it('refuses to run a second time even if the admins were deleted and the secret is still set', async () => {
        await createBootstrapOwner({ email: 'a@ops.example.com', secret: BOOTSTRAP_SECRET })
        await AdminUser.deleteMany({})

        await expect(createBootstrapOwner({ email: 'b@ops.example.com', secret: BOOTSTRAP_SECRET })).rejects.toThrow(
            ERROR_MESSAGES.ADMIN.BOOTSTRAP_ALREADY_DONE
        )
    })

    it('lets exactly one of two concurrent attempts win', async () => {
        const results = await Promise.allSettled([
            createBootstrapOwner({ email: 'a@ops.example.com', secret: BOOTSTRAP_SECRET }),
            createBootstrapOwner({ email: 'b@ops.example.com', secret: BOOTSTRAP_SECRET }),
        ])

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
        expect(await AdminUser.countDocuments()).toBe(1)
    })

    it('rejects an invalid email', async () => {
        await expect(createBootstrapOwner({ email: 'not-an-email', secret: BOOTSTRAP_SECRET })).rejects.toThrow()
        expect(await AdminUser.countDocuments()).toBe(0)
    })
})

describe('enrolment', () => {
    const start = (token: string) => request(app).post(`${ADMIN_BASE}/auth/enrol/start`).send({ token })
    const complete = (body: Record<string, unknown>) => request(app).post(`${ADMIN_BASE}/auth/enrol/complete`).send(body)

    it('a pending owner cannot sign in before enrolling', async () => {
        const { enrolmentToken } = await createBootstrapOwner({ email: 'founder@ops.example.com', secret: BOOTSTRAP_SECRET })
        expect(enrolmentToken).toBeTruthy()

        const res = await request(app)
            .post(`${ADMIN_BASE}/auth/login`)
            .send({ email: 'founder@ops.example.com', password: ADMIN_PASSWORD, totpCode: '123456' })

        expect(res.status).toBe(401)
    })

    it('start returns the TOTP secret and an otpauth uri, and the same secret on a repeat', async () => {
        const { enrolmentToken } = await createBootstrapOwner({ email: 'founder@ops.example.com', secret: BOOTSTRAP_SECRET })

        const first = await start(enrolmentToken)
        const second = await start(enrolmentToken)

        expect(first.status).toBe(200)
        expect(first.body.data.email).toBe('founder@ops.example.com')
        expect(first.body.data.role).toBe('owner')
        expect(first.body.data.requiresPassword).toBe(true)
        expect(first.body.data.secret).toMatch(/^[A-Z2-7]{32}$/)
        expect(first.body.data.otpauthUri).toContain(first.body.data.secret)
        expect(second.body.data.secret).toBe(first.body.data.secret)
        const stored = await AdminUser.findOne({ email: 'founder@ops.example.com' })
        expect(stored?.pendingTotpSecretEnc).not.toContain(first.body.data.secret)
    })

    it.each([['garbage'], [''], ['a'.repeat(43)]])('start refuses the token %j with a generic error', async (token) => {
        const res = await start(token)

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.ENROLMENT_INVALID)
    })

    it('start refuses an expired token', async () => {
        const { enrolmentToken, adminId } = await createBootstrapOwner({ email: 'founder@ops.example.com', secret: BOOTSTRAP_SECRET })
        await AdminUser.updateOne({ _id: adminId }, { $set: { enrolmentExpiresAt: new Date(Date.now() - 1000) } })

        expect((await start(enrolmentToken)).status).toBe(400)
    })

    it('complete sets the password, activates the account, issues ten recovery codes and burns the token', async () => {
        const { enrolmentToken } = await createBootstrapOwner({ email: 'founder@ops.example.com', secret: BOOTSTRAP_SECRET })
        const { body } = await start(enrolmentToken)

        const res = await complete({
            token: enrolmentToken,
            password: ADMIN_PASSWORD,
            totpCode: generateTotpCode(body.data.secret, Date.now()),
        })

        expect(res.status).toBe(200)
        expect(res.body.data.recoveryCodes).toHaveLength(10)
        const admin = await AdminUser.findOne({ email: 'founder@ops.example.com' })
        expect(admin?.status).toBe('active')
        expect(admin?.enrolmentTokenHash ?? null).toBeNull()
        expect(admin?.pendingTotpSecretEnc ?? null).toBeNull()
        expect(await bcrypt.compare(ADMIN_PASSWORD, admin?.passwordHash ?? '')).toBe(true)
        expect(openSecret(admin!.totpSecretEnc!, parseEncryptionKey(ADMIN_TOTP_KEY_HEX))).toBe(body.data.secret)
        expect(admin?.recoveryCodeHashes).toHaveLength(10)
        expect(JSON.stringify(admin?.recoveryCodeHashes)).not.toContain(res.body.data.recoveryCodes[0])
        expect(admin?.moneyBlockedUntil ?? null).toBeNull()

        const again = await complete({ token: enrolmentToken, password: ADMIN_PASSWORD, totpCode: generateTotpCode(body.data.secret, Date.now() + 30_000) })
        expect(again.status).toBe(400)
    })

    it('complete refuses a short password, a wrong code, and leaves the account pending', async () => {
        const { enrolmentToken } = await createBootstrapOwner({ email: 'founder@ops.example.com', secret: BOOTSTRAP_SECRET })
        const { body } = await start(enrolmentToken)
        const goodCode = generateTotpCode(body.data.secret, Date.now())

        const shortPassword = await complete({ token: enrolmentToken, password: 'only-13-chars', totpCode: goodCode })
        const wrongCode = await complete({ token: enrolmentToken, password: ADMIN_PASSWORD, totpCode: '000000' })

        expect(shortPassword.status).toBe(400)
        expect(shortPassword.body.message).toBe(ERROR_MESSAGES.ADMIN.PASSWORD_TOO_SHORT)
        expect(wrongCode.status).toBe(400)
        expect(wrongCode.body.message).toBe(ERROR_MESSAGES.ADMIN.INVALID_TOTP)
        expect((await AdminUser.findOne({ email: 'founder@ops.example.com' }))?.status).toBe('pending')
    })

    it('the enrolled admin can then sign in with the new password and an authenticator code', async () => {
        const { enrolmentToken } = await createBootstrapOwner({ email: 'founder@ops.example.com', secret: BOOTSTRAP_SECRET })
        const { body } = await start(enrolmentToken)
        await complete({ token: enrolmentToken, password: ADMIN_PASSWORD, totpCode: generateTotpCode(body.data.secret, Date.now()) })

        const res = await request(app)
            .post(`${ADMIN_BASE}/auth/login`)
            .send({ email: 'founder@ops.example.com', password: ADMIN_PASSWORD, totpCode: generateTotpCode(body.data.secret, Date.now() + 30_000) })

        expect(res.status).toBe(200)
    })
})

describe('breakGlass', () => {
    it('refuses without the break-glass secret, or with the bootstrap secret', async () => {
        await seedAdmin({ email: 'owner@ops.example.com' })
        await seedAdmin({ email: 'second@ops.example.com' })

        await expect(breakGlass({ email: 'owner@ops.example.com', secret: '' })).rejects.toThrow(ERROR_MESSAGES.ADMIN.BREAKGLASS_SECRET_INVALID)
        await expect(breakGlass({ email: 'owner@ops.example.com', secret: BOOTSTRAP_SECRET })).rejects.toThrow(
            ERROR_MESSAGES.ADMIN.BREAKGLASS_SECRET_INVALID
        )
    })

    it('refuses an unknown admin', async () => {
        await expect(breakGlass({ email: 'nobody@ops.example.com', secret: BREAKGLASS_SECRET })).rejects.toThrow(
            ERROR_MESSAGES.ADMIN.ADMIN_NOT_FOUND
        )
    })

    it('does not set a factor or issue a session: it revokes sessions, clears the factor and hands out an enrolment token', async () => {
        const target = await seedAdmin({ email: 'lost@ops.example.com', role: 'support' })
        await seedAdmin({ email: 'owner@ops.example.com', role: 'owner' })
        await loginAsAdmin(app, target)

        const result = await breakGlass({ email: 'lost@ops.example.com', secret: BREAKGLASS_SECRET })

        const admin = await AdminUser.findById(target.id)
        expect(admin?.status).toBe('reenrol')
        expect(admin?.totpSecretEnc ?? null).toBeNull()
        expect(admin?.recoveryCodeHashes).toHaveLength(0)
        expect(admin?.enrolmentTokenHash).toBe(sha256Hex(result.enrolmentToken))
        expect(await AdminSession.countDocuments({ adminId: target.id, revokedAt: null })).toBe(0)
        expect((await postLogin(app, target)).status).toBe(401)
    })

    it('audits a system-actor row, and emails the affected admin and every other active owner', async () => {
        const target = await seedAdmin({ email: 'lost@ops.example.com', role: 'owner' })
        await seedAdmin({ email: 'other-owner@ops.example.com', role: 'owner' })
        await seedAdmin({ email: 'support@ops.example.com', role: 'support' })
        await seedAdmin({ email: 'gone@ops.example.com', role: 'owner', status: 'disabled' })

        const result = await breakGlass({ email: 'lost@ops.example.com', secret: BREAKGLASS_SECRET })

        const row = await AdminAuditLog.findOne({ action: 'admin.break_glass' }).lean()
        expect(row?.actorType).toBe('system')
        expect(row?.targetAdminId?.toString()).toBe(target.id)
        expect(JSON.stringify(row)).not.toContain('lost@ops.example.com')
        expect(sent.map((m) => m.to).sort()).toEqual(['lost@ops.example.com', 'other-owner@ops.example.com'])
        expect(result.notified).toBe(2)
        for (const message of sent) {
            expect(message.text ?? '').not.toContain(result.enrolmentToken)
            expect(message.html).not.toContain(result.enrolmentToken)
        }
    })

    it('still completes when an email cannot be delivered', async () => {
        await seedAdmin({ email: 'lost@ops.example.com', role: 'support' })
        await seedAdmin({ email: 'owner@ops.example.com', role: 'owner' })
        setMailTransport({
            sendMail: async () => {
                throw new Error('smtp down')
            },
        })

        const result = await breakGlass({ email: 'lost@ops.example.com', secret: BREAKGLASS_SECRET })

        expect(result.enrolmentToken).toBeTruthy()
        expect((await AdminUser.findOne({ email: 'lost@ops.example.com' }))?.status).toBe('reenrol')
    })

    it('re-enrolment needs the existing password (a token holder cannot choose a new one) and blocks money actions for 24 hours', async () => {
        const target = await seedAdmin({ email: 'lost@ops.example.com', role: 'support' })
        await seedAdmin({ email: 'owner@ops.example.com', role: 'owner' })
        const { enrolmentToken } = await breakGlass({ email: 'lost@ops.example.com', secret: BREAKGLASS_SECRET })

        const started = await request(app).post(`${ADMIN_BASE}/auth/enrol/start`).send({ token: enrolmentToken })
        expect(started.body.data.requiresPassword).toBe(false)
        const code = generateTotpCode(started.body.data.secret, Date.now())

        const wrong = await request(app)
            .post(`${ADMIN_BASE}/auth/enrol/complete`)
            .send({ token: enrolmentToken, password: 'a brand new password chosen by thief', totpCode: code })
        const right = await request(app)
            .post(`${ADMIN_BASE}/auth/enrol/complete`)
            .send({ token: enrolmentToken, password: target.password, totpCode: code })

        expect(wrong.status).toBe(400)
        expect(right.status).toBe(200)
        const admin = await AdminUser.findById(target.id)
        expect(admin?.status).toBe('active')
        const blockedFor = (admin?.moneyBlockedUntil?.getTime() ?? 0) - Date.now()
        expect(blockedFor).toBeGreaterThan(23 * HOUR_MS)
        expect(blockedFor).toBeLessThanOrEqual(24 * HOUR_MS)
    })

    it('refuses to reset the last active owner unless it is explicitly confirmed', async () => {
        await seedAdmin({ email: 'only@ops.example.com', role: 'owner' })

        await expect(breakGlass({ email: 'only@ops.example.com', secret: BREAKGLASS_SECRET })).rejects.toThrow(
            ERROR_MESSAGES.ADMIN.LAST_OWNER
        )
        expect((await AdminUser.findOne({ email: 'only@ops.example.com' }))?.status).toBe('active')

        const result = await breakGlass({ email: 'only@ops.example.com', secret: BREAKGLASS_SECRET, confirmLastOwner: true })

        expect(result.enrolmentToken).toBeTruthy()
        expect((await AdminUser.findOne({ email: 'only@ops.example.com' }))?.status).toBe('reenrol')
    })
})
