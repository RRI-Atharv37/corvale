import request from 'supertest'
import { Types } from 'mongoose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import app from '@http/app'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { authHeader, registerUser } from '@tests/helpers'
import { buildAdminApp, disableAdmin, seedAdmin } from '@tests/adminHelpers'
import {
    ADMIN_AUDIT_ACTIONS,
    AUDIT_ERASURE_REDACTION,
    AUDIT_IP_SCRUB,
    AdminAuditLog,
    redactAdminAuditSubject,
    recordAudit,
    sanitizeAuditState,
    scrubAuditIps,
    validateReason,
} from '@modules/admin'
import { deleteUserAccountCascade } from '@modules/users/accountDeletionUtils'

/**
 * M7.1 - the admin audit log: append-only, allowlisted before/after, no email and no provider id
 * ever, and severed from the subject on erasure (D5) while the accountability record survives.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const oid = (): Types.ObjectId => new Types.ObjectId()
const ERASURE_OPTIONS = { timestamps: false, [AUDIT_ERASURE_REDACTION]: true }
const IP_SCRUB_OPTIONS = { timestamps: false, [AUDIT_IP_SCRUB]: true }

beforeAll(() => {
    buildAdminApp()
})

afterAll(() => {
    disableAdmin()
})

describe('recordAudit', () => {
    it('stores who did what, to whom, with an allowlisted before/after', async () => {
        const adminId = oid()
        const subjectUserId = oid()

        await recordAudit({
            adminId,
            adminRole: 'owner',
            action: 'grant.comp',
            subjectUserId,
            subjectSubscriptionId: oid(),
            before: { planCode: 'plus', status: 'trial_expired' },
            after: { planCode: 'pro', status: 'active' },
            reason: 'Support goodwill for a billing incident',
            requestId: 'req-1',
            ip: '203.0.113.9',
        })

        const row = await AdminAuditLog.findOne({}).lean()
        expect(row?.adminId?.toString()).toBe(adminId.toString())
        expect(row?.actorType).toBe('admin')
        expect(row?.action).toBe('grant.comp')
        expect(row?.before).toEqual({ planCode: 'plus', status: 'trial_expired' })
        expect(row?.after).toEqual({ planCode: 'pro', status: 'active' })
        expect(row?.at).toBeInstanceOf(Date)
    })

    it('drops any before/after key that is not on the allowlist, including provider ids and emails', () => {
        const state = sanitizeAuditState({
            planCode: 'pro',
            status: 'active',
            providerCustomerId: 'cus_123',
            providerSubscriptionId: 'sub_123',
            email: 'a@b.com',
            fullName: 'A B',
            password: 'x',
            trialEndsAt: new Date('2026-01-01T00:00:00.000Z'),
        })

        expect(state).toEqual({ planCode: 'pro', status: 'active', trialEndsAt: '2026-01-01T00:00:00.000Z' })
    })

    it('sanitises a grant to its structural fields, never its free-text reason', () => {
        const state = sanitizeAuditState({
            adminGrant: {
                kind: 'comp',
                planCode: 'pro',
                until: new Date('2026-02-01T00:00:00.000Z'),
                reason: 'jane@example.com asked nicely',
                grantedBy: oid(),
            },
        })

        expect(state).toEqual({ adminGrant: { kind: 'comp', planCode: 'pro', until: '2026-02-01T00:00:00.000Z' } })
    })

    it('never persists a row that carries an email or a provider id anywhere', async () => {
        await recordAudit({
            adminId: oid(),
            adminRole: 'owner',
            action: 'grant.comp',
            before: { providerSubscriptionId: 'sub_secret', email: 'leak@example.com' } as never,
            after: { planCode: 'pro' },
        })

        const raw = JSON.stringify(await AdminAuditLog.find({}).lean())
        expect(raw).not.toContain('sub_secret')
        expect(raw).not.toContain('leak@example.com')
    })

    it('refuses an action that is not in the catalogue', async () => {
        await expect(
            recordAudit({ adminId: oid(), adminRole: 'owner', action: 'drop.everything' as never })
        ).rejects.toThrow()
    })

    it('has an action for every M7.1-M7.3 capability', () => {
        for (const action of [
            'admin.login',
            'admin.login_failed',
            'admin.lockout',
            'admin.stepup_failed',
            'admin.bootstrap',
            'admin.break_glass',
            'admin.invited',
            'admin.totp_reset',
            'admin.status_changed',
            'subscription.viewed',
            'grant.comp',
            'grant.plan_override',
            'grant.revoked',
            'trial.extended',
            'erasure.hold_set',
            'erasure.hold_cleared',
        ]) {
            expect(ADMIN_AUDIT_ACTIONS).toContain(action)
        }
    })
})

describe('validateReason', () => {
    it('accepts 10-500 characters and trims', () => {
        expect(validateReason('  Customer paid but stayed read-only  ')).toBe('Customer paid but stayed read-only')
    })

    it.each([[undefined], [null], [42], ['short'], ['x'.repeat(501)], ['          ']])('rejects %j', (value) => {
        expect(() => validateReason(value)).toThrow(CustomError)
    })

    it('rejects a reason containing an email address', () => {
        expect(() => validateReason('Comp requested by sam@example.org today')).toThrow(ERROR_MESSAGES.ADMIN.REASON_CONTAINS_EMAIL)
    })
})

describe('append-only', () => {
    const seed = () =>
        AdminAuditLog.create({
            adminId: oid(),
            adminRole: 'owner',
            actorType: 'admin',
            action: 'grant.comp',
            subjectUserId: oid(),
            reason: 'because a reason is needed',
            ip: '203.0.113.9',
            at: new Date(),
        })

    it.each([
        ['action', { $set: { action: 'admin.login' } }],
        ['adminId', { $set: { adminId: oid() } }],
        ['before', { $set: { before: { planCode: 'plus' } } }],
        ['at', { $set: { at: new Date(0) } }],
        ['subjectUserId to another user', { $set: { subjectUserId: oid() } }],
    ])('refuses to rewrite %s', async (_name, update) => {
        const row = await seed()

        await expect(AdminAuditLog.updateOne({ _id: row._id }, update)).rejects.toThrow(/append-only/)
        await expect(AdminAuditLog.updateMany({}, update)).rejects.toThrow(/append-only/)
        await expect(AdminAuditLog.findOneAndUpdate({ _id: row._id }, update)).rejects.toThrow(/append-only/)
    })

    it('refuses replaces and every kind of delete', async () => {
        const row = await seed()

        await expect(AdminAuditLog.replaceOne({ _id: row._id }, { action: 'admin.login' })).rejects.toThrow(/append-only/)
        await expect(AdminAuditLog.deleteOne({ _id: row._id })).rejects.toThrow(/append-only/)
        await expect(AdminAuditLog.deleteMany({})).rejects.toThrow(/append-only/)
        await expect(AdminAuditLog.findOneAndDelete({ _id: row._id })).rejects.toThrow(/append-only/)
        await expect(row.deleteOne()).rejects.toThrow(/append-only/)
        expect(await AdminAuditLog.countDocuments()).toBe(1)
    })

    it('the sanctioned erasure update only accepts the subject links and the reason', async () => {
        const row = await seed()

        await expect(
            AdminAuditLog.updateOne(
                { _id: row._id },
                { $set: { subjectUserId: null, action: 'admin.login' } },
                ERASURE_OPTIONS
            )
        ).rejects.toThrow(/append-only/)
        await expect(
            AdminAuditLog.updateOne({ _id: row._id }, { $unset: { ip: 1 } }, ERASURE_OPTIONS)
        ).rejects.toThrow(/append-only/)
    })

    it('the sanctioned ip scrub only accepts unsetting ip', async () => {
        const row = await seed()

        await expect(
            AdminAuditLog.updateOne({ _id: row._id }, { $unset: { reason: 1 } }, IP_SCRUB_OPTIONS)
        ).rejects.toThrow(/append-only/)
        await expect(
            AdminAuditLog.updateOne({ _id: row._id }, { $unset: { ip: 1 } }, IP_SCRUB_OPTIONS)
        ).resolves.toBeTruthy()
    })
})

describe('erasure (D5)', () => {
    it('nulls both subject links and redacts the reason, and leaves the accountability record', async () => {
        const subjectUserId = oid()
        const subjectSubscriptionId = oid()
        const adminId = oid()
        await recordAudit({
            adminId,
            adminRole: 'owner',
            action: 'grant.comp',
            subjectUserId,
            subjectSubscriptionId,
            before: { planCode: 'plus' },
            after: { planCode: 'pro' },
            reason: 'Goodwill after the outage last week',
            amountMinor: 900,
            currency: 'USD',
        })
        await recordAudit({ adminId, adminRole: 'owner', action: 'grant.comp', subjectUserId: oid(), reason: 'Someone else entirely' })

        const changed = await redactAdminAuditSubject(subjectUserId.toString())

        expect(changed).toBe(1)
        const rows = await AdminAuditLog.find({}).lean()
        const redacted = rows.find((row) => row.reason === '[redacted on erasure]')
        expect(redacted?.subjectUserId ?? null).toBeNull()
        expect(redacted?.subjectSubscriptionId ?? null).toBeNull()
        expect(redacted?.adminId?.toString()).toBe(adminId.toString())
        expect(redacted?.action).toBe('grant.comp')
        expect(redacted?.amountMinor).toBe(900)
        expect(redacted?.after).toEqual({ planCode: 'pro' })
        const untouched = rows.find((row) => row.reason === 'Someone else entirely')
        expect(untouched?.subjectUserId).toBeTruthy()
    })

    it('is a no-op for a user with no audit rows', async () => {
        expect(await redactAdminAuditSubject(oid().toString())).toBe(0)
    })

    it('deleting the account through the cascade leaves no audit row that names the erased user or subscription', async () => {
        const user = await registerUser(app)
        const subscriptionId = oid()
        await recordAudit({
            adminId: oid(),
            adminRole: 'support',
            action: 'trial.extended',
            subjectUserId: new Types.ObjectId(user.userId),
            subjectSubscriptionId: subscriptionId,
            reason: 'Trial extension after a sync bug',
        })
        await recordAudit({
            adminId: oid(),
            adminRole: 'support',
            action: 'subscription.viewed',
            subjectUserId: new Types.ObjectId(user.userId),
        })

        await deleteUserAccountCascade(user.userId)

        expect(await AdminAuditLog.countDocuments({ subjectUserId: user.userId })).toBe(0)
        expect(await AdminAuditLog.countDocuments({ subjectSubscriptionId: subscriptionId })).toBe(0)
        expect(await AdminAuditLog.countDocuments({ reason: 'Trial extension after a sync bug' })).toBe(0)
        expect(await AdminAuditLog.countDocuments()).toBe(2)
    })

    it('deleting the account over HTTP does the same', async () => {
        const user = await registerUser(app, { email: 'gone@example.com', password: 'DeleteMeNow123!' })
        await recordAudit({
            adminId: oid(),
            adminRole: 'support',
            action: 'subscription.viewed',
            subjectUserId: new Types.ObjectId(user.userId),
        })

        const res = await request(app).delete('/api/v1/auth/account').set(authHeader(user.token)).send({ password: 'DeleteMeNow123!' })

        expect(res.status).toBe(200)
        expect(await AdminAuditLog.countDocuments({ subjectUserId: user.userId })).toBe(0)
    })
})

describe('retention', () => {
    it('scrubs the ip from rows older than 90 days and keeps the row', async () => {
        const now = new Date('2027-01-01T00:00:00.000Z')
        const admin = await seedAdmin()
        const old = await AdminAuditLog.create({
            adminId: admin.id,
            adminRole: 'owner',
            actorType: 'admin',
            action: 'admin.login',
            ip: '198.51.100.1',
            at: new Date(now.getTime() - 91 * DAY_MS),
        })
        const recent = await AdminAuditLog.create({
            adminId: admin.id,
            adminRole: 'owner',
            actorType: 'admin',
            action: 'admin.login',
            ip: '198.51.100.2',
            at: new Date(now.getTime() - 10 * DAY_MS),
        })

        const scrubbed = await scrubAuditIps(now)

        expect(scrubbed).toBe(1)
        expect((await AdminAuditLog.findById(old._id).lean())?.ip ?? null).toBeNull()
        expect((await AdminAuditLog.findById(old._id).lean())?.action).toBe('admin.login')
        expect((await AdminAuditLog.findById(recent._id).lean())?.ip).toBe('198.51.100.2')
        expect(await scrubAuditIps(now)).toBe(0)
    })

    it('gives routine rows a 400-day expiry and keeps money and permanent actions with no expiry', async () => {
        const at = new Date('2027-01-01T00:00:00.000Z')
        await recordAudit({ adminId: oid(), adminRole: 'owner', action: 'admin.login', at })
        await recordAudit({ adminId: oid(), adminRole: 'owner', action: 'grant.comp', at })
        await recordAudit({ adminId: oid(), adminRole: 'owner', action: 'admin.invited', at })

        const login = await AdminAuditLog.findOne({ action: 'admin.login' }).lean()
        const comp = await AdminAuditLog.findOne({ action: 'grant.comp' }).lean()
        const invited = await AdminAuditLog.findOne({ action: 'admin.invited' }).lean()

        expect(login?.expireAt?.getTime()).toBe(at.getTime() + 400 * DAY_MS)
        expect(comp?.expireAt ?? null).toBeNull()
        expect(invited?.expireAt ?? null).toBeNull()
    })

    it('indexes expireAt as a TTL index', async () => {
        const indexes = await AdminAuditLog.collection.indexes()

        expect(indexes.some((index) => index.key.expireAt === 1 && index.expireAfterSeconds === 0)).toBe(true)
    })
})
