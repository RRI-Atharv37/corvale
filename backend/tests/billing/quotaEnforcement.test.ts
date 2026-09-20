import fs from 'node:fs'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { Receipt } from '@modules/receipts'
import { RECEIPT_UPLOAD_ROOT } from '@modules/receipts/receiptUtils'
import { Workspace } from '@modules/workspaces'
import { SyncDevice, UsageCounter, recomputeUsageCounters } from '@modules/billing'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { authHeader, createSecondUser, registerUser, seedUserDirectly, type RegisteredUser } from '@tests/helpers'
import {
    disableBilling,
    enableBilling,
    seedPendingInvite,
    seedTestPlans,
    seedWorkspace,
    setSubscription,
} from '@tests/billingHelpers'

/**
 * M1 - quota enforcement (`requireQuota`), called directly against the API. Limits come from the
 * plan (`null` = unlimited); a request that would push usage past the limit is refused with 402
 * before anything is stored. Reads, deletes and pulls are never quota-gated - a quota only ever
 * blocks *adding* data, so an over-quota user can always reduce usage or leave with their data.
 */

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\n%%EOF')
const SIZE = PDF.length

const uploadReceipt = (token: string) =>
    request(app)
        .post('/api/v1/receipts')
        .set(authHeader(token))
        .attach('receipt', PDF, { filename: 'r.pdf', contentType: 'application/pdf' })

afterEach(() => {
    disableBilling()
    if (fs.existsSync(RECEIPT_UPLOAD_ROOT)) {
        fs.rmSync(RECEIPT_UPLOAD_ROOT, { recursive: true, force: true })
    }
})

describe('receipt storage quota (plan.limits.receiptStorageBytes)', () => {
    let user: RegisteredUser

    beforeEach(async () => {
        enableBilling()
        await seedTestPlans({ plus: { limits: { receiptStorageBytes: SIZE * 2 } } })
        user = await registerUser(app)
        await setSubscription(user.userId, { planCode: 'plus' })
    })

    it('accepts uploads up to exactly the limit and refuses the next with 402 QUOTA_EXCEEDED', async () => {
        expect((await uploadReceipt(user.token)).status).toBe(201)
        expect((await uploadReceipt(user.token)).status).toBe(201)

        const third = await uploadReceipt(user.token)

        expect(third.status).toBe(402)
        expect(third.body.message).toBe(ERROR_MESSAGES.BILLING.QUOTA_EXCEEDED)
        expect(await Receipt.countDocuments({ userId: user.userId })).toBe(2)
    })

    it('leaves no orphaned file behind on a refused upload', async () => {
        await uploadReceipt(user.token)
        await uploadReceipt(user.token)
        const before = fs.readdirSync(`${RECEIPT_UPLOAD_ROOT}/${user.userId}`).length

        await uploadReceipt(user.token)

        expect(fs.readdirSync(`${RECEIPT_UPLOAD_ROOT}/${user.userId}`)).toHaveLength(before)
    })

    it('deleting a receipt frees its bytes', async () => {
        const first = await uploadReceipt(user.token)
        await uploadReceipt(user.token)
        expect((await uploadReceipt(user.token)).status).toBe(402)

        const del = await request(app).delete(`/api/v1/receipts/${first.body.data._id}`).set(authHeader(user.token))
        expect(del.status).toBe(200)

        expect((await uploadReceipt(user.token)).status).toBe(201)
    })

    it('is per user: another user on the same plan has their own allowance', async () => {
        await uploadReceipt(user.token)
        await uploadReceipt(user.token)
        const other = await createSecondUser(app)
        await setSubscription(other.userId, { planCode: 'plus' })

        expect((await uploadReceipt(other.token)).status).toBe(201)
    })

    it('a plan with a null limit is unlimited', async () => {
        await seedTestPlans({ plus: { limits: { receiptStorageBytes: null } } })

        for (let i = 0; i < 4; i += 1) {
            expect((await uploadReceipt(user.token)).status).toBe(201)
        }
    })

    it('upgrading raises the limit on the next request', async () => {
        await uploadReceipt(user.token)
        await uploadReceipt(user.token)
        expect((await uploadReceipt(user.token)).status).toBe(402)

        await setSubscription(user.userId, { planCode: 'pro' })

        expect((await uploadReceipt(user.token)).status).toBe(201)
    })

    it('parallel uploads cannot race past the limit', async () => {
        await seedTestPlans({ plus: { limits: { receiptStorageBytes: SIZE } } })

        const results = await Promise.all([1, 2, 3, 4].map(() => uploadReceipt(user.token)))

        expect(results.filter((r) => r.status === 201)).toHaveLength(1)
        expect(results.filter((r) => r.status === 402)).toHaveLength(3)
        expect(await Receipt.countDocuments({ userId: user.userId })).toBe(1)
    })

    it('quotas are not applied while billing is off', async () => {
        disableBilling()

        for (let i = 0; i < 4; i += 1) {
            expect((await uploadReceipt(user.token)).status).toBe(201)
        }
    })
})

describe('UsageCounter is a cache, not the source of truth', () => {
    it('recomputeUsageCounters restores a drifted receiptBytes counter from the receipts themselves', async () => {
        enableBilling()
        await seedTestPlans()
        const user = await registerUser(app)
        await setSubscription(user.userId, { planCode: 'plus' })
        await uploadReceipt(user.token)
        await uploadReceipt(user.token)

        await UsageCounter.updateMany({ userId: user.userId, resource: 'receiptBytes' }, { $set: { value: 0 } })
        await recomputeUsageCounters(user.userId)

        const counter = await UsageCounter.findOne({ userId: user.userId, resource: 'receiptBytes' }).lean()
        expect(counter?.value).toBe(SIZE * 2)
    })
})

describe('workspace member quota (plan.limits.workspaceMembers)', () => {
    let owner: RegisteredUser
    let workspaceId: string

    beforeEach(async () => {
        enableBilling()
        await seedTestPlans({ pro: { limits: { workspaceMembers: 2 } } })
        owner = await registerUser(app)
        await setSubscription(owner.userId, { planCode: 'pro' })
        workspaceId = await seedWorkspace(owner.userId)
    })

    const invite = (email: string) =>
        request(app)
            .post(`/api/v1/workspaces/${workspaceId}/members`)
            .set(authHeader(owner.token))
            .send({ email, role: 'editor' })

    it('counts the owner and pending invites: the owner plus one invitee fills a limit of 2', async () => {
        const a = await seedUserDirectly({ email: 'quota-a@example.com' })
        const b = await seedUserDirectly({ email: 'quota-b@example.com' })

        expect((await invite(a.email)).status).toBe(201)

        const second = await invite(b.email)
        expect(second.status).toBe(402)
        expect(second.body.message).toBe(ERROR_MESSAGES.BILLING.QUOTA_EXCEEDED)
    })

    it('an accepted member holds the slot just as a pending invite does', async () => {
        const a = await seedUserDirectly({ email: 'quota-a@example.com' })
        const b = await seedUserDirectly({ email: 'quota-b@example.com' })
        const invited = await invite(a.email)
        await request(app)
            .post(`/api/v1/workspaces/invites/${invited.body.data._id}/accept`)
            .set(authHeader(a.token))

        expect((await invite(b.email)).status).toBe(402)
    })

    it('a declined invite releases its slot', async () => {
        const a = await seedUserDirectly({ email: 'quota-a@example.com' })
        const b = await seedUserDirectly({ email: 'quota-b@example.com' })
        const invited = await invite(a.email)
        await request(app)
            .post(`/api/v1/workspaces/invites/${invited.body.data._id}/decline`)
            .set(authHeader(a.token))

        expect((await invite(b.email)).status).toBe(201)
    })

    it('removing a member releases their slot', async () => {
        const a = await seedUserDirectly({ email: 'quota-a@example.com' })
        const b = await seedUserDirectly({ email: 'quota-b@example.com' })
        const invited = await invite(a.email)
        await request(app)
            .post(`/api/v1/workspaces/invites/${invited.body.data._id}/accept`)
            .set(authHeader(a.token))
        await request(app)
            .delete(`/api/v1/workspaces/${workspaceId}/members/${a.userId}`)
            .set(authHeader(owner.token))

        expect((await invite(b.email)).status).toBe(201)
    })

    it('an unlimited plan (null) never refuses an invite', async () => {
        await seedTestPlans({ pro: { limits: { workspaceMembers: null } } })
        for (let i = 0; i < 4; i += 1) {
            const u = await seedUserDirectly({ email: `bulk-${i}@example.com` })
            expect((await invite(u.email)).status).toBe(201)
        }
    })

    it('refuses without creating the invite', async () => {
        const a = await seedUserDirectly({ email: 'quota-a@example.com' })
        const b = await seedUserDirectly({ email: 'quota-b@example.com' })
        await seedPendingInvite(workspaceId, owner.userId, a.userId)

        await invite(b.email)

        const { WorkspaceInvite } = await import('@modules/workspaces')
        expect(await WorkspaceInvite.countDocuments({ workspaceId, inviteeUserId: b.userId })).toBe(0)
        expect((await Workspace.findById(workspaceId))?.members).toHaveLength(1)
    })
})

describe('sync device limit (plan.limits.syncDevices)', () => {
    let user: RegisteredUser
    let opCounter = 0

    const push = (token: string, deviceId?: string) =>
        request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(token))
            .send({
                ...(deviceId === undefined ? {} : { deviceId }),
                ops: [
                    {
                        opId: `op-${(opCounter += 1)}`,
                        entity: 'account',
                        operation: 'create',
                        payload: { name: `Acct ${opCounter}`, type: 'checking', openingBalance: 1 },
                    },
                ],
            })

    const pull = (token: string, deviceId?: string) =>
        request(app).get('/api/v1/sync/pull').query(deviceId ? { deviceId } : {}).set(authHeader(token))

    beforeEach(async () => {
        enableBilling()
        await seedTestPlans()
        user = await registerUser(app)
        await setSubscription(user.userId, { planCode: 'plus' })
    })

    it('the first device pushes; a second is refused 402 SYNC_DEVICE_LIMIT but may still pull', async () => {
        expect((await push(user.token, 'device-a')).status).toBe(200)

        const second = await push(user.token, 'device-b')
        expect(second.status).toBe(402)
        expect(second.body.message).toBe(ERROR_MESSAGES.BILLING.SYNC_DEVICE_LIMIT)

        expect((await pull(user.token, 'device-b')).status).toBe(200)
        const bootstrap = await request(app)
            .get('/api/v1/sync/bootstrap')
            .query({ deviceId: 'device-b' })
            .set(authHeader(user.token))
        expect(bootstrap.status).toBe(200)
    })

    it('the first device keeps pushing after a second appears', async () => {
        await push(user.token, 'device-a')
        await push(user.token, 'device-b')

        expect((await push(user.token, 'device-a')).status).toBe(200)
    })

    it('a refused push applies none of its ops', async () => {
        await push(user.token, 'device-a')
        const { Account } = await import('@modules/accounts')
        const before = await Account.countDocuments({ userId: user.userId })

        await push(user.token, 'device-b')

        expect(await Account.countDocuments({ userId: user.userId })).toBe(before)
    })

    it('devices are ranked by first-seen order, not by request order', async () => {
        await pull(user.token, 'device-a')
        await pull(user.token, 'device-b')

        expect((await push(user.token, 'device-b')).status).toBe(402)
        expect((await push(user.token, 'device-a')).status).toBe(200)
    })

    it('upgrading to Pro lets every registered device push', async () => {
        await push(user.token, 'device-a')
        await pull(user.token, 'device-b')
        expect((await push(user.token, 'device-b')).status).toBe(402)

        await setSubscription(user.userId, { planCode: 'pro' })

        expect((await push(user.token, 'device-b')).status).toBe(200)
    })

    it('a client that sends no deviceId counts as one implicit device', async () => {
        expect((await push(user.token)).status).toBe(200)
        expect((await push(user.token)).status).toBe(200)

        expect((await push(user.token, 'device-a')).status).toBe(402)
    })

    it('registers each device once, however often it syncs', async () => {
        await push(user.token, 'device-a')
        await push(user.token, 'device-a')
        await pull(user.token, 'device-a')

        expect(await SyncDevice.countDocuments({ userId: user.userId, deviceId: 'device-a' })).toBe(1)
    })

    it('device limits are per user', async () => {
        await push(user.token, 'device-a')
        const other = await createSecondUser(app)
        await setSubscription(other.userId, { planCode: 'plus' })

        expect((await push(other.token, 'device-a')).status).toBe(200)
        expect((await push(other.token, 'device-b')).status).toBe(402)
    })

    it.each([{ $ne: 'x' }, '', 'has space', 'x'.repeat(65), 42])('rejects a malformed deviceId (%j) with 400', async (bad) => {
        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(user.token))
            .send({
                deviceId: bad,
                ops: [{ opId: 'op-bad', entity: 'account', operation: 'create', payload: { name: 'x', type: 'checking' } }],
            })

        expect(res.status).toBe(400)
    })

    it('no device limit applies while billing is off', async () => {
        disableBilling()

        expect((await push(user.token, 'device-a')).status).toBe(200)
        expect((await push(user.token, 'device-b')).status).toBe(200)
    })
})
