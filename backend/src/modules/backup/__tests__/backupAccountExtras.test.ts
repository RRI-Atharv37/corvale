import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'

import app from '@http/app'
import { Account } from '@modules/accounts'
import { SyncDevice } from '@modules/billing'
import { ReconciliationSession } from '@modules/reconciliation'
import { SavedReport } from '@modules/reports'
import { Pushover, Saver } from '@modules/savers'
import { authHeader, seedUserDirectly } from '@tests/helpers'

/**
 * SEC-93 - `privacy.md` says Backup and Restore "exports everything". The export used to leave out
 * reconciliation sessions, saver and rollover history, saved reports, the profile, sync devices and
 * workspace memberships. They are now exported (and served on their own for the desktop export).
 * They are not restorable: a restore ignores them and says so.
 */

const SECRET_FIELDS = ['password', 'tokenVersion', 'passwordResetTokenHash', 'emailVerificationTokenHash', 'userId']

const seedPersonalExtras = async () => {
    const user = await seedUserDirectly({ email: 'extras-owner@example.com' })
    const account = await Account.create({
        userId: user.userId,
        name: 'Checking',
        type: 'checking',
        openingBalance: 100000,
        currency: 'USD',
    })
    await ReconciliationSession.create({
        userId: user.userId,
        accountId: account._id,
        statementEndDate: new Date('2026-01-31T00:00:00.000Z'),
        statementBalance: 100000,
        clearedBalance: 100000,
        pendingBalance: 0,
        balanceDifferential: 0,
    })
    await SavedReport.create({
        userId: user.userId,
        name: 'Monthly spend',
        config: { periodType: 'monthly', splitBy: 'category', chartType: 'donut', dataType: 'expense' },
    })
    const deletedReport = await SavedReport.create({
        userId: user.userId,
        name: 'Deleted report',
        config: { periodType: 'monthly', splitBy: 'category', chartType: 'donut', dataType: 'expense' },
    })
    await SavedReport.deleteOne({ _id: deletedReport._id })
    await Saver.create({ userId: user.userId, saverAmount: 5000, pushoverAmount: 1200 })
    await Pushover.create({ userId: user.userId, pushoverAmount: 700, pushoverDate: new Date('2026-01-31T00:00:00.000Z') })
    await SyncDevice.create({
        userId: user.userId,
        deviceId: 'device-abc',
        kind: 'desktop',
        name: 'Work laptop',
        firstSeenAt: new Date('2026-01-01T00:00:00.000Z'),
        lastSeenAt: new Date('2026-01-02T00:00:00.000Z'),
    })
    return { user, account }
}

describe('Export includes the account-level data (SEC-93)', () => {
    it('adds reconciliation sessions, saved reports, saver and rollover history, profile, devices and memberships', async () => {
        const { user } = await seedPersonalExtras()
        const workspaceRes = await request(app)
            .post('/api/v1/workspaces')
            .set(authHeader(user.token))
            .send({ name: 'Household' })
        expect(workspaceRes.status).toBe(201)

        const res = await request(app).get('/api/v1/backup/export').query({ format: 'json' }).set(authHeader(user.token))
        expect(res.status).toBe(200)
        const payload = JSON.parse(res.text)

        expect(payload.reconciliationSessions).toHaveLength(1)
        expect(payload.reconciliationSessions[0]).toMatchObject({ statementBalance: 100000, balanceDifferential: 0 })
        expect(payload.savedReports.map((r: { name: string }) => r.name)).toEqual(['Monthly spend'])
        expect(payload.savers).toHaveLength(1)
        expect(payload.savers[0]).toMatchObject({ saverAmount: 5000, pushoverAmount: 1200 })
        expect(payload.rollovers).toHaveLength(1)
        expect(payload.rollovers[0]).toMatchObject({ pushoverAmount: 700 })
        expect(payload.devices).toHaveLength(1)
        expect(payload.devices[0]).toMatchObject({ deviceId: 'device-abc', kind: 'desktop', name: 'Work laptop' })
        expect(payload.workspaceMemberships).toHaveLength(1)
        expect(payload.workspaceMemberships[0]).toMatchObject({ name: 'Household', role: 'owner' })
        expect(payload.profile).toMatchObject({
            email: 'extras-owner@example.com',
            timezone: expect.any(String),
            preferredCurrency: expect.any(String),
            notificationPreferences: expect.any(Object),
        })
    })

    it('never exports credentials, token state or user ids', async () => {
        const { user } = await seedPersonalExtras()

        const res = await request(app).get('/api/v1/backup/export').query({ format: 'json' }).set(authHeader(user.token))
        const payload = JSON.parse(res.text)

        for (const field of SECRET_FIELDS) {
            expect(payload.profile).not.toHaveProperty(field)
            for (const section of ['reconciliationSessions', 'savedReports', 'savers', 'rollovers', 'devices']) {
                for (const record of payload[section]) expect(record).not.toHaveProperty(field)
            }
        }
        expect(res.text).not.toContain(user.userId)
    })

    it('leaves the counts and the existing sections exactly as they were', async () => {
        const { user } = await seedPersonalExtras()

        const res = await request(app).get('/api/v1/backup/export').query({ format: 'json' }).set(authHeader(user.token))
        const payload = JSON.parse(res.text)

        expect(Object.keys(payload.counts).sort()).toEqual(
            [
                'accounts',
                'budgets',
                'categories',
                'categorizationRules',
                'receipts',
                'recurringRules',
                'savingsGoalContributions',
                'savingsGoals',
                'tags',
                'transactionTemplates',
                'transactions',
            ].sort()
        )
        expect(payload.accounts).toHaveLength(1)
    })

    it('exports empty sections, not missing ones, for a user with nothing in them', async () => {
        const user = await seedUserDirectly({ email: 'extras-empty@example.com' })

        const res = await request(app).get('/api/v1/backup/export').query({ format: 'json' }).set(authHeader(user.token))
        const payload = JSON.parse(res.text)

        for (const section of ['reconciliationSessions', 'savedReports', 'savers', 'rollovers', 'devices', 'workspaceMemberships']) {
            expect(payload[section]).toEqual([])
        }
        expect(payload.profile.email).toBe('extras-empty@example.com')
    })

    it('carries them in the ZIP export too', async () => {
        const { user } = await seedPersonalExtras()

        const res = await request(app)
            .get('/api/v1/backup/export')
            .query({ format: 'zip' })
            .set(authHeader(user.token))
            .buffer(true)
            .parse((response, callback) => {
                const chunks: Buffer[] = []
                response.on('data', (chunk: Buffer) => chunks.push(chunk))
                response.on('end', () => callback(null, Buffer.concat(chunks)))
            })

        expect(res.status).toBe(200)
        const body = res.body as Buffer
        expect(body.includes(Buffer.from('corvale-backup.json'))).toBe(true)
    })
})

describe('Workspace-scoped export (SEC-93)', () => {
    const seedWorkspace = async () => {
        const { user, account } = await seedPersonalExtras()
        const workspaceRes = await request(app)
            .post('/api/v1/workspaces')
            .set(authHeader(user.token))
            .send({ name: 'Household' })
        const workspaceId = workspaceRes.body.data._id as string
        await ReconciliationSession.create({
            userId: user.userId,
            workspaceId,
            accountId: account._id,
            statementEndDate: new Date('2026-02-28T00:00:00.000Z'),
            statementBalance: 1,
            clearedBalance: 1,
            pendingBalance: 0,
            balanceDifferential: 0,
        })
        await SavedReport.create({
            userId: user.userId,
            workspaceId,
            name: 'Shared report',
            config: { periodType: 'monthly', splitBy: 'category', chartType: 'donut', dataType: 'expense' },
        })
        return { user, workspaceId }
    }

    it('includes only that workspace\'s sessions and reports, and none of the personal account data', async () => {
        const { user, workspaceId } = await seedWorkspace()

        const res = await request(app)
            .get('/api/v1/backup/export')
            .query({ format: 'json', workspaceId })
            .set(authHeader(user.token))
        const payload = JSON.parse(res.text)

        expect(payload.reconciliationSessions).toHaveLength(1)
        expect(payload.reconciliationSessions[0].statementBalance).toBe(1)
        expect(payload.savedReports.map((r: { name: string }) => r.name)).toEqual(['Shared report'])
        expect(payload.profile).toBeNull()
        expect(payload.savers).toEqual([])
        expect(payload.rollovers).toEqual([])
        expect(payload.devices).toEqual([])
        expect(payload.workspaceMemberships).toEqual([])
    })

    it('personal export leaves workspace sessions and reports out', async () => {
        const { user } = await seedWorkspace()

        const res = await request(app).get('/api/v1/backup/export').query({ format: 'json' }).set(authHeader(user.token))
        const payload = JSON.parse(res.text)

        expect(payload.reconciliationSessions).toHaveLength(1)
        expect(payload.reconciliationSessions[0].statementBalance).toBe(100000)
        expect(payload.savedReports.map((r: { name: string }) => r.name)).toEqual(['Monthly spend'])
    })
})

describe('GET /backup/extras (SEC-93, desktop export)', () => {
    it('serves the same account-level sections on their own', async () => {
        const { user } = await seedPersonalExtras()

        const res = await request(app).get('/api/v1/backup/extras').set(authHeader(user.token))

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        const data = res.body.data
        expect(Object.keys(data).sort()).toEqual(
            ['devices', 'profile', 'reconciliationSessions', 'rollovers', 'savedReports', 'savers', 'workspaceMemberships'].sort()
        )
        expect(data.reconciliationSessions).toHaveLength(1)
        expect(data.profile.email).toBe('extras-owner@example.com')
    })

    it('requires authentication', async () => {
        const res = await request(app).get('/api/v1/backup/extras')
        expect(res.status).toBe(401)
    })

    it('refuses a workspace the caller is not a member of', async () => {
        const { user } = await seedPersonalExtras()
        const stranger = await seedUserDirectly({ email: 'extras-stranger@example.com' })
        const workspaceRes = await request(app)
            .post('/api/v1/workspaces')
            .set(authHeader(user.token))
            .send({ name: 'Private' })

        const res = await request(app)
            .get('/api/v1/backup/extras')
            .query({ workspaceId: workspaceRes.body.data._id })
            .set(authHeader(stranger.token))

        expect([403, 404]).toContain(res.status)
    })

    it('rejects a malformed workspace id with a 400', async () => {
        const user = await seedUserDirectly({ email: 'extras-malformed@example.com' })

        const res = await request(app)
            .get('/api/v1/backup/extras')
            .query({ workspaceId: 'not-an-id' })
            .set(authHeader(user.token))

        expect(res.status).toBe(400)
    })

    it('does not leak another user\'s rows', async () => {
        await seedPersonalExtras()
        const other = await seedUserDirectly({ email: 'extras-other@example.com' })
        await Saver.create({ userId: new Types.ObjectId(), saverAmount: 1 })

        const res = await request(app).get('/api/v1/backup/extras').set(authHeader(other.token))

        expect(res.body.data.reconciliationSessions).toEqual([])
        expect(res.body.data.savers).toEqual([])
        expect(res.body.data.profile.email).toBe('extras-other@example.com')
    })
})

describe('Restore and the account-level sections (SEC-93)', () => {
    it('restores a file that carries them, ignores them, and says so in the preview', async () => {
        const { user } = await seedPersonalExtras()
        const exported = await request(app).get('/api/v1/backup/export').query({ format: 'json' }).set(authHeader(user.token))
        const backup = JSON.parse(exported.text)
        const target = await seedUserDirectly({ email: 'extras-target@example.com' })

        const preview = await request(app)
            .post('/api/v1/backup/preview')
            .set(authHeader(target.token))
            .send({ backup })
        expect(preview.status).toBe(200)
        expect(preview.body.data.valid).toBe(true)
        expect(preview.body.data.warnings.join(' ')).toMatch(/not restored/i)

        const commit = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(target.token))
            .send({ backup })
        expect(commit.status).toBe(201)
        expect(await ReconciliationSession.countDocuments({ userId: target.userId })).toBe(0)
        expect(await SavedReport.countDocuments({ userId: target.userId })).toBe(0)
        expect(await Saver.countDocuments({ userId: target.userId })).toBe(0)
    })

    it('still restores an older file that has none of the sections, without the warning', async () => {
        const { user } = await seedPersonalExtras()
        const exported = await request(app).get('/api/v1/backup/export').query({ format: 'json' }).set(authHeader(user.token))
        const backup = JSON.parse(exported.text)
        for (const key of ['reconciliationSessions', 'savedReports', 'savers', 'rollovers', 'profile', 'devices', 'workspaceMemberships']) {
            delete backup[key]
        }
        const target = await seedUserDirectly({ email: 'extras-old@example.com' })

        const preview = await request(app)
            .post('/api/v1/backup/preview')
            .set(authHeader(target.token))
            .send({ backup })

        expect(preview.status).toBe(200)
        expect(preview.body.data.valid).toBe(true)
        expect(preview.body.data.warnings.join(' ')).not.toMatch(/not restored/i)
    })

    it('rejects a malformed account-level section rather than trusting it', async () => {
        const { user } = await seedPersonalExtras()
        const exported = await request(app).get('/api/v1/backup/export').query({ format: 'json' }).set(authHeader(user.token))
        const backup = JSON.parse(exported.text)
        backup.reconciliationSessions = 'nope'
        const target = await seedUserDirectly({ email: 'extras-bad@example.com' })

        const res = await request(app).post('/api/v1/backup/preview').set(authHeader(target.token)).send({ backup })

        expect(res.status).toBe(400)
    })
})
