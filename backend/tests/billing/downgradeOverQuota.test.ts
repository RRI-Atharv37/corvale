import fs from 'node:fs'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { Receipt } from '@modules/receipts'
import { RECEIPT_UPLOAD_ROOT } from '@modules/receipts/receiptUtils'
import { Transaction } from '@modules/transactions'
import { Workspace } from '@modules/workspaces'
import { SyncDevice } from '@modules/billing'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { authHeader, registerUser, seedUserDirectly, type RegisteredUser } from '@tests/helpers'
import {
    createAccountViaApi,
    createExpenseViaApi,
    disableBilling,
    enableBilling,
    getFoodMasterId,
    seedTestPlans,
    seedWorkspace,
    setSubscription,
} from '@tests/billingHelpers'

/**
 * M1 - downgrade Pro -> Plus with over-quota data (M5b). Governing rule: nothing is destroyed by a
 * billing state change. Over-limit data stays readable and downloadable; only *adding* to it stops:
 *   - workspaces become read-only (members can still read; writes 402 ENTITLEMENT_REQUIRED)
 *   - receipts over the storage limit stay downloadable and deletable, new uploads are refused
 *   - sync devices beyond the limit keep pulling but stop pushing
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

describe('downgrade - workspaces go read-only, nothing is deleted', () => {
    let owner: RegisteredUser
    let editor: RegisteredUser
    let workspaceId: string
    let accountId: string
    let categoryId: string

    beforeEach(async () => {
        enableBilling()
        await seedTestPlans()
        owner = await registerUser(app)
        editor = await seedUserDirectly({ email: 'dg-editor@example.com' })
        await setSubscription(owner.userId, { planCode: 'pro' })
        await setSubscription(editor.userId, { planCode: 'plus' })
        workspaceId = await seedWorkspace(owner.userId, [{ userId: editor.userId, role: 'editor' }])

        accountId = await createAccountViaApi(app, owner.token, { workspaceId })
        categoryId = await getFoodMasterId(app, owner.token)
        const tx = await createExpenseViaApi(app, owner.token, accountId, categoryId, { workspaceId, title: 'Shared lunch' })
        expect(tx.status).toBe(201)

        await setSubscription(owner.userId, { planCode: 'plus' })
    })

    const workspaceWrite = (token: string) =>
        createExpenseViaApi(app, token, accountId, categoryId, { workspaceId, title: 'Post-downgrade' })

    it('the owner and the editor can still read every workspace record', async () => {
        for (const who of [owner, editor]) {
            const list = await request(app).get('/api/v1/transactions').query({ workspaceId }).set(authHeader(who.token))
            expect(list.status).toBe(200)
            expect(JSON.stringify(list.body)).toContain('Shared lunch')

            const ws = await request(app).get(`/api/v1/workspaces/${workspaceId}`).set(authHeader(who.token))
            expect(ws.status).toBe(200)
        }
    })

    it('writes to the workspace are refused 402 ENTITLEMENT_REQUIRED for the owner and for members', async () => {
        for (const who of [owner, editor]) {
            const res = await workspaceWrite(who.token)

            expect(res.status).toBe(402)
            expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.ENTITLEMENT_REQUIRED)
        }
        expect(await Transaction.countDocuments({ workspaceId })).toBe(1)
    })

    it('workspace management is frozen too: no invites, no rename, no new workspaces', async () => {
        const invitee = await seedUserDirectly({ email: 'dg-invitee@example.com' })

        const invite = await request(app)
            .post(`/api/v1/workspaces/${workspaceId}/members`)
            .set(authHeader(owner.token))
            .send({ email: invitee.email, role: 'viewer' })
        const rename = await request(app)
            .patch(`/api/v1/workspaces/${workspaceId}`)
            .set(authHeader(owner.token))
            .send({ name: 'Renamed' })
        const create = await request(app).post('/api/v1/workspaces').set(authHeader(owner.token)).send({ name: 'Second' })

        expect([invite.status, rename.status, create.status]).toEqual([402, 402, 402])
        expect((await Workspace.findById(workspaceId))?.name).toBe('Shared')
    })

    it('personal data on the same Plus plan is unaffected', async () => {
        const res = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(owner.token))
            .send({ name: 'Personal', type: 'checking', openingBalance: 1 })

        expect(res.status).toBe(201)
    })

    it('nothing was deleted', async () => {
        expect(await Workspace.countDocuments({})).toBe(1)
        expect(await Transaction.countDocuments({ workspaceId })).toBe(1)
        expect((await Workspace.findById(workspaceId))?.members).toHaveLength(2)
    })

    it('re-upgrading restores workspace writes on the same workspace', async () => {
        await setSubscription(owner.userId, { planCode: 'pro' })

        expect((await workspaceWrite(editor.token)).status).toBe(201)
    })
})

describe('downgrade - receipts over the storage limit', () => {
    let user: RegisteredUser
    const receiptIds: string[] = []

    beforeEach(async () => {
        receiptIds.length = 0
        enableBilling()
        await seedTestPlans({ plus: { limits: { receiptStorageBytes: SIZE } } })
        user = await registerUser(app)
        await setSubscription(user.userId, { planCode: 'pro' })
        for (let i = 0; i < 3; i += 1) {
            const res = await uploadReceipt(user.token)
            expect(res.status).toBe(201)
            receiptIds.push(res.body.data._id)
        }

        await setSubscription(user.userId, { planCode: 'plus' })
    })

    it('every over-limit receipt stays downloadable', async () => {
        for (const receiptId of receiptIds) {
            const res = await request(app).get(`/api/v1/receipts/${receiptId}`).set(authHeader(user.token))

            expect(res.status).toBe(200)
        }
    })

    it('new uploads are refused while usage exceeds the limit, and nothing is auto-deleted', async () => {
        const res = await uploadReceipt(user.token)

        expect(res.status).toBe(402)
        expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.QUOTA_EXCEEDED)
        expect(await Receipt.countDocuments({ userId: user.userId })).toBe(3)
    })

    it('deleting is always allowed, and uploads resume only once usage + the new file fits', async () => {
        expect((await request(app).delete(`/api/v1/receipts/${receiptIds[0]}`).set(authHeader(user.token))).status).toBe(200)
        expect((await uploadReceipt(user.token)).status).toBe(402)

        expect((await request(app).delete(`/api/v1/receipts/${receiptIds[1]}`).set(authHeader(user.token))).status).toBe(200)
        expect((await uploadReceipt(user.token)).status).toBe(402)

        expect((await request(app).delete(`/api/v1/receipts/${receiptIds[2]}`).set(authHeader(user.token))).status).toBe(200)
        expect((await uploadReceipt(user.token)).status).toBe(201)
    })

    it('the backup export still succeeds while over quota', async () => {
        const res = await request(app).get('/api/v1/backup/export').set(authHeader(user.token))

        expect(res.status).toBe(200)
    })

    it('re-upgrading lifts the block on the same receipts', async () => {
        await setSubscription(user.userId, { planCode: 'pro' })

        expect((await uploadReceipt(user.token)).status).toBe(201)
        expect(await Receipt.countDocuments({ userId: user.userId })).toBe(4)
    })
})

describe('downgrade - extra sync devices pull but stop pushing', () => {
    let user: RegisteredUser
    let n = 0

    const push = (deviceId: string) =>
        request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(user.token))
            .send({
                deviceId,
                ops: [
                    {
                        opId: `dg-op-${(n += 1)}`,
                        entity: 'account',
                        operation: 'create',
                        payload: { name: `Acct ${n}`, type: 'checking', openingBalance: 1 },
                    },
                ],
            })

    const pull = (deviceId: string) =>
        request(app).get('/api/v1/sync/pull').query({ deviceId }).set(authHeader(user.token))

    beforeEach(async () => {
        enableBilling()
        await seedTestPlans()
        user = await registerUser(app)
        await setSubscription(user.userId, { planCode: 'pro' })
        for (const device of ['laptop', 'desktop', 'tablet']) {
            expect((await push(device)).status).toBe(200)
        }

        await setSubscription(user.userId, { planCode: 'plus' })
    })

    it('only the earliest-registered device (within the limit) may keep pushing', async () => {
        expect((await push('laptop')).status).toBe(200)

        for (const device of ['desktop', 'tablet']) {
            const res = await push(device)
            expect(res.status).toBe(402)
            expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.SYNC_DEVICE_LIMIT)
        }
    })

    it('every device keeps pulling, including the ones that can no longer push', async () => {
        for (const device of ['laptop', 'desktop', 'tablet']) {
            expect((await pull(device)).status).toBe(200)
        }
    })

    it('no device registration is discarded by the downgrade', async () => {
        expect(await SyncDevice.countDocuments({ userId: user.userId })).toBe(3)
    })

    it('re-upgrading lets all three push again', async () => {
        await setSubscription(user.userId, { planCode: 'pro' })

        for (const device of ['laptop', 'desktop', 'tablet']) {
            expect((await push(device)).status).toBe(200)
        }
    })
})

describe('downgrade - the entitlement snapshot tells the UI what happened', () => {
    it('reports Plus features and limits while read/export stay true', async () => {
        enableBilling()
        await seedTestPlans()
        const user = await registerUser(app)
        await setSubscription(user.userId, { planCode: 'pro' })
        await setSubscription(user.userId, { planCode: 'plus' })

        const res = await request(app).get('/api/v1/auth/user').set(authHeader(user.token))

        const e = res.body.data.entitlements
        expect(e.planCode).toBe('plus')
        expect(e.features.workspaces).toBe(false)
        expect(e.limits.syncDevices).toBe(1)
        expect(e.canWrite).toBe(true)
        expect(e.canRead).toBe(true)
        expect(e.canExport).toBe(true)
    })
})
