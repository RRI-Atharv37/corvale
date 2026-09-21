import request from 'supertest'
import type { Application } from 'express'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { sha256Hex } from '@core/auth/tokenHash'
import { setMailTransport, type MailMessage } from '@infra/mail/mailService'
import {
    ADMIN_BASE,
    HOUR_MS,
    bearer,
    buildAdminApp,
    disableAdmin,
    loginAsAdmin,
    seedAdmin,
    type SeededAdmin,
} from '@tests/adminHelpers'
import { AdminAuditLog, AdminSession, AdminUser } from '@modules/admin'

/**
 * M7.1 - who may manage admins (owners only, step-up required), what it audits, and the last-owner rule.
 */

const REASON = 'Onboarding the new support person'

let app: Application
let owner: SeededAdmin
let ownerToken: string
let sent: MailMessage[]

beforeAll(() => {
    app = buildAdminApp()
})

afterAll(() => {
    disableAdmin()
})

beforeEach(async () => {
    sent = []
    setMailTransport({
        sendMail: async (message) => {
            sent.push(message)
            return { messageId: 'test' }
        },
    })
    owner = await seedAdmin({ role: 'owner', email: 'owner@ops.example.com' })
    ;({ token: ownerToken } = await loginAsAdmin(app, owner))
})

const invite = (token: string, body: Record<string, unknown>) =>
    request(app).post(`${ADMIN_BASE}/admins/invite`).set(bearer(token)).send(body)

describe('capability checks', () => {
    it.each(['support', 'finance'] as const)('a %s admin cannot list, invite, reset or disable admins or read the audit log', async (role) => {
        const other = await seedAdmin({ role })
        const { token } = await loginAsAdmin(app, other)

        const responses = await Promise.all([
            request(app).get(`${ADMIN_BASE}/admins`).set(bearer(token)),
            invite(token, { email: 'x@ops.example.com', role: 'support', reason: REASON }),
            request(app).post(`${ADMIN_BASE}/admins/${owner.id}/reset-totp`).set(bearer(token)).send({ reason: REASON }),
            request(app).patch(`${ADMIN_BASE}/admins/${owner.id}`).set(bearer(token)).send({ status: 'disabled', reason: REASON }),
            request(app).get(`${ADMIN_BASE}/audit`).set(bearer(token)),
        ])

        for (const res of responses) {
            expect(res.status).toBe(403)
            expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.FORBIDDEN)
        }
    })

    it('an unauthenticated caller gets 401 everywhere', async () => {
        expect((await request(app).get(`${ADMIN_BASE}/admins`)).status).toBe(401)
        expect((await request(app).get(`${ADMIN_BASE}/audit`)).status).toBe(401)
    })
})

describe('GET /admins', () => {
    it('lists admins with an allowlisted shape', async () => {
        await seedAdmin({ role: 'support', email: 'support@ops.example.com' })

        const res = await request(app).get(`${ADMIN_BASE}/admins`).set(bearer(ownerToken))

        expect(res.status).toBe(200)
        expect(res.body.data.admins).toHaveLength(2)
        for (const admin of res.body.data.admins) {
            expect(Object.keys(admin).sort()).toEqual(
                ['createdAt', 'email', 'id', 'lastLoginAt', 'moneyBlockedUntil', 'role', 'status'].sort()
            )
        }
    })
})

describe('POST /admins/invite', () => {
    it('creates a pending admin with a 24-hour single-use enrolment token and audits it without the email', async () => {
        const res = await invite(ownerToken, { email: 'New.Person@ops.example.com', role: 'finance', reason: REASON })

        expect(res.status).toBe(201)
        const created = await AdminUser.findOne({ email: 'new.person@ops.example.com' })
        expect(created?.status).toBe('pending')
        expect(created?.role).toBe('finance')
        expect(created?.passwordHash ?? null).toBeNull()
        expect(created?.invitedBy?.toString()).toBe(owner.id)
        expect(created?.enrolmentTokenHash).toBe(sha256Hex(res.body.data.enrolmentToken))
        const lifetime = new Date(res.body.data.expiresAt).getTime() - Date.now()
        expect(lifetime).toBeGreaterThan(23 * HOUR_MS)
        expect(lifetime).toBeLessThanOrEqual(24 * HOUR_MS)

        const row = await AdminAuditLog.findOne({ action: 'admin.invited' }).lean()
        expect(row?.adminId?.toString()).toBe(owner.id)
        expect(row?.reason).toBe(REASON)
        expect(JSON.stringify(row)).not.toContain('new.person@ops.example.com')
        expect(JSON.stringify(row)).not.toContain(res.body.data.enrolmentToken)
    })

    it('rejects a duplicate email, an unknown role, a bad email and a missing or emailed reason', async () => {
        await seedAdmin({ email: 'taken@ops.example.com', role: 'support' })

        expect((await invite(ownerToken, { email: 'taken@ops.example.com', role: 'support', reason: REASON })).status).toBe(409)
        expect((await invite(ownerToken, { email: 'a@ops.example.com', role: 'root', reason: REASON })).status).toBe(400)
        expect((await invite(ownerToken, { email: 'not-an-email', role: 'support', reason: REASON })).status).toBe(400)
        expect((await invite(ownerToken, { email: 'a@ops.example.com', role: 'support' })).status).toBe(400)
        expect((await invite(ownerToken, { email: 'a@ops.example.com', role: 'support', reason: 'short' })).status).toBe(400)
        const leaky = await invite(ownerToken, { email: 'a@ops.example.com', role: 'support', reason: 'Refund for jane@example.com case' })
        expect(leaky.status).toBe(400)
        expect(leaky.body.message).toBe(ERROR_MESSAGES.ADMIN.REASON_CONTAINS_EMAIL)
    })

    it('needs a fresh step-up', async () => {
        await AdminSession.updateMany({ adminId: owner.id }, { $set: { stepUpAt: null } })

        const res = await invite(ownerToken, { email: 'a@ops.example.com', role: 'support', reason: REASON })

        expect(res.status).toBe(403)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.STEP_UP_REQUIRED)
        expect(await AdminUser.countDocuments()).toBe(1)
    })

    it('is blocked for 24 hours after the inviting owner was re-enrolled', async () => {
        await AdminUser.updateOne({ _id: owner.id }, { $set: { moneyBlockedUntil: new Date(Date.now() + HOUR_MS) } })

        const res = await invite(ownerToken, { email: 'a@ops.example.com', role: 'support', reason: REASON })

        expect(res.status).toBe(403)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.STEP_UP_DISABLED)
    })
})

describe('POST /admins/:adminId/reset-totp', () => {
    let target: SeededAdmin
    let targetToken: string

    beforeEach(async () => {
        target = await seedAdmin({ role: 'support', email: 'target@ops.example.com' })
        ;({ token: targetToken } = await loginAsAdmin(app, target))
    })

    it("clears the target's factor, revokes their sessions, returns a new enrolment token and emails the target", async () => {
        const res = await request(app).post(`${ADMIN_BASE}/admins/${target.id}/reset-totp`).set(bearer(ownerToken)).send({ reason: REASON })

        expect(res.status).toBe(200)
        const admin = await AdminUser.findById(target.id)
        expect(admin?.status).toBe('reenrol')
        expect(admin?.totpSecretEnc ?? null).toBeNull()
        expect(admin?.recoveryCodeHashes).toHaveLength(0)
        expect(admin?.enrolmentTokenHash).toBe(sha256Hex(res.body.data.enrolmentToken))
        expect((await request(app).get(`${ADMIN_BASE}/auth/me`).set(bearer(targetToken))).status).toBe(401)
        expect(sent.map((m) => m.to)).toContain('target@ops.example.com')
        expect(sent.every((m) => !m.html.includes(res.body.data.enrolmentToken))).toBe(true)
        const row = await AdminAuditLog.findOne({ action: 'admin.totp_reset' }).lean()
        expect(row?.adminId?.toString()).toBe(owner.id)
        expect(row?.targetAdminId?.toString()).toBe(target.id)
    })

    it('an admin cannot reset their own factor this way', async () => {
        const res = await request(app).post(`${ADMIN_BASE}/admins/${owner.id}/reset-totp`).set(bearer(ownerToken)).send({ reason: REASON })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.CANNOT_TARGET_SELF)
        expect((await AdminUser.findById(owner.id))?.status).toBe('active')
    })

    it('needs step-up and a valid target', async () => {
        await AdminSession.updateMany({ adminId: owner.id }, { $set: { stepUpAt: null } })
        expect((await request(app).post(`${ADMIN_BASE}/admins/${target.id}/reset-totp`).set(bearer(ownerToken)).send({ reason: REASON })).status).toBe(403)

        await AdminSession.updateMany({ adminId: owner.id }, { $set: { stepUpAt: new Date() } })
        expect((await request(app).post(`${ADMIN_BASE}/admins/000000000000000000000000/reset-totp`).set(bearer(ownerToken)).send({ reason: REASON })).status).toBe(404)
        expect((await request(app).post(`${ADMIN_BASE}/admins/not-an-id/reset-totp`).set(bearer(ownerToken)).send({ reason: REASON })).status).toBe(400)
    })
})

describe('PATCH /admins/:adminId', () => {
    it('disables an admin, revokes their sessions and can re-enable them', async () => {
        const target = await seedAdmin({ role: 'finance' })
        const { token } = await loginAsAdmin(app, target)

        const disabled = await request(app).patch(`${ADMIN_BASE}/admins/${target.id}`).set(bearer(ownerToken)).send({ status: 'disabled', reason: REASON })

        expect(disabled.status).toBe(200)
        expect((await AdminUser.findById(target.id))?.status).toBe('disabled')
        expect((await request(app).get(`${ADMIN_BASE}/auth/me`).set(bearer(token))).status).toBe(401)
        expect(await AdminAuditLog.countDocuments({ action: 'admin.status_changed' })).toBe(1)

        const enabled = await request(app).patch(`${ADMIN_BASE}/admins/${target.id}`).set(bearer(ownerToken)).send({ status: 'active', reason: REASON })
        expect(enabled.status).toBe(200)
        expect((await AdminUser.findById(target.id))?.status).toBe('active')
    })

    it('will not enable an account that never finished enrolling', async () => {
        const target = await seedAdmin({ role: 'support', status: 'pending' })

        const res = await request(app).patch(`${ADMIN_BASE}/admins/${target.id}`).set(bearer(ownerToken)).send({ status: 'active', reason: REASON })

        expect(res.status).toBe(400)
        expect((await AdminUser.findById(target.id))?.status).toBe('pending')
    })

    it('will not disable the last active owner, even themselves', async () => {
        const res = await request(app).patch(`${ADMIN_BASE}/admins/${owner.id}`).set(bearer(ownerToken)).send({ status: 'disabled', reason: REASON })

        expect(res.status).toBe(409)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.LAST_OWNER)
        expect((await AdminUser.findById(owner.id))?.status).toBe('active')
    })

    it('can disable an owner when another active owner remains', async () => {
        const second = await seedAdmin({ role: 'owner' })

        const res = await request(app).patch(`${ADMIN_BASE}/admins/${second.id}`).set(bearer(ownerToken)).send({ status: 'disabled', reason: REASON })

        expect(res.status).toBe(200)
    })

    it('rejects an unknown status', async () => {
        const target = await seedAdmin({ role: 'support' })

        expect((await request(app).patch(`${ADMIN_BASE}/admins/${target.id}`).set(bearer(ownerToken)).send({ status: 'reenrol', reason: REASON })).status).toBe(400)
    })
})

describe('GET /audit', () => {
    it('returns audit rows newest first, filtered and paginated, with an allowlisted shape', async () => {
        await invite(ownerToken, { email: 'a@ops.example.com', role: 'support', reason: REASON })

        const res = await request(app).get(`${ADMIN_BASE}/audit?action=admin.invited&limit=10`).set(bearer(ownerToken))

        expect(res.status).toBe(200)
        expect(res.body.data.entries).toHaveLength(1)
        expect(res.body.data.entries[0].action).toBe('admin.invited')
        expect(res.body.data.entries[0].adminId).toBe(owner.id)
        expect(res.body.data.total).toBe(1)
        const raw = JSON.stringify(res.body)
        expect(raw).not.toContain('a@ops.example.com')
        expect(raw).not.toContain('enrolmentToken')
    })

    it('rejects an unknown action filter and an oversized page', async () => {
        expect((await request(app).get(`${ADMIN_BASE}/audit?action=drop.database`).set(bearer(ownerToken))).status).toBe(400)
        expect((await request(app).get(`${ADMIN_BASE}/audit?limit=1000`).set(bearer(ownerToken))).status).toBe(400)
    })
})
