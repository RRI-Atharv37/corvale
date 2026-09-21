import fs from 'node:fs'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { Types } from 'mongoose'
import { Account } from '@modules/accounts'
import { Transaction } from '@modules/transactions'
import { RECEIPT_UPLOAD_ROOT } from '@modules/receipts/receiptUtils'
import { Workspace } from '@modules/workspaces'
import { SyncDevice, UsageCounter } from '@modules/billing'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { authHeader, registerUser, seedUserDirectly, type RegisteredUser } from '@tests/helpers'
import {
    BILLING_STATES,
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
 * M4 - wiring decisions the route-classification suites do not pin: a resolver must read the field
 * its controller reads, leaving a workspace can never be paywalled, the seat counter follows the
 * rows, and a malformed device id is a 400 on the pull side too.
 */

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\n%%EOF')

const uploadReceipt = (token: string) =>
    request(app)
        .post('/api/v1/receipts')
        .set(authHeader(token))
        .attach('receipt', PDF, { filename: 'r.pdf', contentType: 'application/pdf' })

const counter = async (userId: string, resource: 'receiptBytes') =>
    (await UsageCounter.findOne({ userId, resource }).lean())?.value

afterEach(() => {
    disableBilling()
    if (fs.existsSync(RECEIPT_UPLOAD_ROOT)) {
        fs.rmSync(RECEIPT_UPLOAD_ROOT, { recursive: true, force: true })
    }
})

describe('a scope resolver reads the field its controller reads', () => {
    let owner: RegisteredUser
    let editor: RegisteredUser
    let workspaceId: string

    beforeEach(async () => {
        enableBilling()
        await seedTestPlans()
        owner = await registerUser(app)
        editor = await seedUserDirectly({ email: 'wiring-editor@example.com' })
        await setSubscription(owner.userId, BILLING_STATES.active)
        await setSubscription(editor.userId, BILLING_STATES.trial_expired)
        workspaceId = await seedWorkspace(owner.userId, [{ userId: editor.userId, role: 'editor' }])
    })

    it("a lapsed member creating an account for a workspace, by body, uses the owner's plan", async () => {
        const res = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(editor.token))
            .send({ name: 'Shared', type: 'checking', openingBalance: 1, workspaceId })

        expect(res.status).toBe(201)
    })

    it('...but naming the workspace only in the query does not turn a personal create into a workspace one', async () => {
        const res = await request(app)
            .post('/api/v1/accounts')
            .query({ workspaceId })
            .set(authHeader(editor.token))
            .send({ name: 'Personal in disguise', type: 'checking', openingBalance: 1 })

        expect(res.status).toBe(402)
        expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.READ_ONLY)
        expect(await Account.countDocuments({ userId: editor.userId })).toBe(0)
    })

    it('generate-drafts reads the query, so a workspace named only in the body is still personal', async () => {
        const res = await request(app)
            .post('/api/v1/recurring-rules/generate-drafts')
            .set(authHeader(editor.token))
            .send({ workspaceId })

        expect(res.status).toBe(402)
    })

    it('generate-drafts with the workspace in the query is judged on the owner', async () => {
        const res = await request(app)
            .post('/api/v1/recurring-rules/generate-drafts')
            .query({ workspaceId })
            .set(authHeader(editor.token))
            .send({})

        expect(res.status).not.toBe(402)
    })

    it('a malformed workspace id is a 400 from the gate, before any write', async () => {
        const res = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(owner.token))
            .send({ name: 'x', type: 'checking', workspaceId: 'nope' })

        expect(res.status).toBe(400)
    })

    it('a non-member cannot name a workspace to borrow its plan', async () => {
        const stranger = await seedUserDirectly({ email: 'wiring-stranger@example.com' })
        await setSubscription(stranger.userId, BILLING_STATES.trial_expired)

        const res = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(stranger.token))
            .send({ name: 'x', type: 'checking', workspaceId })

        expect(res.status).toBe(403)
    })
})

describe('leaving or shrinking a workspace is never paywalled', () => {
    let owner: RegisteredUser
    let editor: RegisteredUser
    let workspaceId: string

    beforeEach(async () => {
        enableBilling()
        await seedTestPlans()
        owner = await registerUser(app)
        editor = await seedUserDirectly({ email: 'leaver@example.com' })
        await setSubscription(owner.userId, { ...BILLING_STATES.trial_expired })
        workspaceId = await seedWorkspace(owner.userId, [{ userId: editor.userId, role: 'editor' }])
    })

    it('a member can leave a workspace whose owner has lapsed', async () => {
        const res = await request(app)
            .delete(`/api/v1/workspaces/${workspaceId}/members/${editor.userId}`)
            .set(authHeader(editor.token))

        expect(res.status).toBe(200)
        expect((await Workspace.findById(workspaceId))?.members).toHaveLength(1)
    })

    it('a lapsed owner can still remove a member', async () => {
        const res = await request(app)
            .delete(`/api/v1/workspaces/${workspaceId}/members/${editor.userId}`)
            .set(authHeader(owner.token))

        expect(res.status).toBe(200)
    })

    it('role changes are still frozen', async () => {
        const res = await request(app)
            .patch(`/api/v1/workspaces/${workspaceId}/members/${editor.userId}`)
            .set(authHeader(owner.token))
            .send({ role: 'viewer' })

        expect(res.status).toBe(402)
    })
})

describe('bulk routes take one scope and verify every id against it', () => {
    let owner: RegisteredUser
    let editor: RegisteredUser
    let workspaceId: string
    let categoryId: string
    let sharedIds: string[]
    let personalId: string

    beforeEach(async () => {
        enableBilling()
        await seedTestPlans()
        owner = await registerUser(app)
        editor = await seedUserDirectly({ email: 'bulk-editor@example.com' })
        await setSubscription(owner.userId, BILLING_STATES.active)
        await setSubscription(editor.userId, BILLING_STATES.active)
        workspaceId = await seedWorkspace(owner.userId, [{ userId: editor.userId, role: 'editor' }])
        categoryId = await getFoodMasterId(app, owner.token)

        const sharedAccount = await createAccountViaApi(app, owner.token, { workspaceId })
        sharedIds = []
        for (const title of ['Shared A', 'Shared B']) {
            sharedIds.push((await createExpenseViaApi(app, owner.token, sharedAccount, categoryId, { workspaceId, title })).body.data._id)
        }
        const personalAccount = await createAccountViaApi(app, editor.token)
        personalId = (await createExpenseViaApi(app, editor.token, personalAccount, categoryId, { title: 'Mine' })).body.data._id

        await setSubscription(editor.userId, BILLING_STATES.trial_expired)
    })

    const bulkDelete = (token: string, transactionIds: unknown) =>
        request(app).post('/api/v1/transactions/bulk/delete').set(authHeader(token)).send({ transactionIds })

    it("a lapsed member bulk-edits workspace records on the paying owner's plan", async () => {
        const res = await bulkDelete(editor.token, sharedIds)

        expect(res.status).toBe(200)
        expect(await Transaction.countDocuments({ workspaceId })).toBe(0)
    })

    it('refuses a list that mixes personal and workspace records, in either order, and deletes nothing', async () => {
        for (const ids of [[personalId, ...sharedIds], [...sharedIds, personalId]]) {
            const res = await bulkDelete(editor.token, ids)

            expect(res.status).toBe(400)
        }
        expect(await Transaction.countDocuments({ workspaceId })).toBe(2)
        expect(await Transaction.countDocuments({ _id: personalId })).toBe(1)
    })

    it('a workspace id first cannot carry a personal id through on the owner plan', async () => {
        const res = await request(app)
            .patch('/api/v1/transactions/bulk/category')
            .set(authHeader(editor.token))
            .send({ transactionIds: [sharedIds[0], personalId], categoryId })

        expect(res.status).toBe(400)
    })

    it('refuses a list with an id that does not exist, even when the first ids are fine', async () => {
        const res = await bulkDelete(editor.token, [sharedIds[0], new Types.ObjectId().toString()])

        expect(res.status).toBe(404)
        expect(await Transaction.countDocuments({ workspaceId })).toBe(2)
    })

    it('a personal-only list from the lapsed member is READ_ONLY', async () => {
        const res = await bulkDelete(editor.token, [personalId])

        expect(res.status).toBe(402)
        expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.READ_ONLY)
        expect(await Transaction.countDocuments({ _id: personalId })).toBe(1)
    })

    it('a lapsed owner freezes bulk edits of the workspace for everyone', async () => {
        await setSubscription(owner.userId, BILLING_STATES.trial_expired)

        const res = await bulkDelete(editor.token, sharedIds)

        expect(res.status).toBe(402)
        expect(await Transaction.countDocuments({ workspaceId })).toBe(2)
    })
})

describe('the member limit is per workspace and follows that workspace\'s rows', () => {
    let owner: RegisteredUser

    beforeEach(async () => {
        enableBilling()
        await seedTestPlans({ pro: { limits: { workspaceMembers: 2 } } })
        owner = await registerUser(app)
        await setSubscription(owner.userId, BILLING_STATES.active)
    })

    const createWorkspace = (name: string) => request(app).post('/api/v1/workspaces').set(authHeader(owner.token)).send({ name })
    const inviteTo = (workspaceId: string, email: string) =>
        request(app)
            .post(`/api/v1/workspaces/${workspaceId}/members`)
            .set(authHeader(owner.token))
            .send({ email, role: 'editor' })
    const seats = async (workspaceId: string) => (await Workspace.findById(workspaceId).lean())?.seatCount

    it('creating a workspace is never blocked by the member limit, however many the owner has', async () => {
        for (const name of ['One', 'Two', 'Three']) {
            expect((await createWorkspace(name)).status).toBe(201)
        }
    })

    it('every workspace gets the whole allowance: filling one leaves the others open', async () => {
        const first = (await createWorkspace('One')).body.data._id
        const second = (await createWorkspace('Two')).body.data._id
        const a = await seedUserDirectly({ email: 'seat-a@example.com' })
        const b = await seedUserDirectly({ email: 'seat-b@example.com' })
        const c = await seedUserDirectly({ email: 'seat-c@example.com' })

        expect((await inviteTo(first, a.email)).status).toBe(201)
        const full = await inviteTo(first, b.email)
        expect(full.status).toBe(402)
        expect(full.body.message).toBe(ERROR_MESSAGES.BILLING.QUOTA_EXCEEDED)

        expect((await inviteTo(second, c.email)).status).toBe(201)
    })

    it('a limit of one leaves no room to invite anyone', async () => {
        await seedTestPlans({ pro: { limits: { workspaceMembers: 1 } } })
        const created = await createWorkspace('Home')
        const invitee = await seedUserDirectly({ email: 'seat-invitee@example.com' })

        expect((await inviteTo(created.body.data._id, invitee.email)).status).toBe(402)
    })

    it('a refused invite leaves the seat count where it was, and a real one moves it by one', async () => {
        const id = (await createWorkspace('Home')).body.data._id
        const a = await seedUserDirectly({ email: 'seat-a@example.com' })
        const b = await seedUserDirectly({ email: 'seat-b@example.com' })

        expect((await inviteTo(id, a.email)).status).toBe(201)
        expect(await seats(id)).toBe(2)
        expect((await inviteTo(id, b.email)).status).toBe(402)
        expect(await seats(id)).toBe(2)
    })

    it('a failed invite (unknown user) does not hold a seat', async () => {
        const id = (await createWorkspace('Home')).body.data._id

        const res = await inviteTo(id, 'nobody@example.com')

        expect(res.status).toBe(404)
        expect((await seats(id)) ?? 1).toBe(1)
    })

    it('a member leaving frees the seat', async () => {
        const id = (await createWorkspace('Home')).body.data._id
        const a = await seedUserDirectly({ email: 'seat-leaver@example.com' })
        const invited = await inviteTo(id, a.email)
        await request(app).post(`/api/v1/workspaces/invites/${invited.body.data._id}/accept`).set(authHeader(a.token))
        expect(await seats(id)).toBe(2)

        await request(app).delete(`/api/v1/workspaces/${id}/members/${a.userId}`).set(authHeader(a.token))

        expect(await seats(id)).toBe(1)
    })

    it('accepting an invite does not take a second seat, declining frees the first', async () => {
        const id = (await createWorkspace('Home')).body.data._id
        const a = await seedUserDirectly({ email: 'seat-accept@example.com' })
        const b = await seedUserDirectly({ email: 'seat-decline@example.com' })
        const accepted = await inviteTo(id, a.email)
        await request(app).post(`/api/v1/workspaces/invites/${accepted.body.data._id}/accept`).set(authHeader(a.token))
        expect(await seats(id)).toBe(2)

        await seedTestPlans({ pro: { limits: { workspaceMembers: 3 } } })
        const declined = await inviteTo(id, b.email)
        expect(await seats(id)).toBe(3)
        await request(app).post(`/api/v1/workspaces/invites/${declined.body.data._id}/decline`).set(authHeader(b.token))

        expect(await seats(id)).toBe(2)
    })

    it('what Corvale knows about the workspace does not depend on billing: seats are counted while billing is off', async () => {
        disableBilling()
        const id = (await createWorkspace('Home')).body.data._id
        const a = await seedUserDirectly({ email: 'seat-off@example.com' })

        expect((await inviteTo(id, a.email)).status).toBe(201)
        expect(await seats(id)).toBe(2)

        enableBilling()
        const b = await seedUserDirectly({ email: 'seat-on@example.com' })
        expect((await inviteTo(id, b.email)).status).toBe(402)
    })
})

describe('the receipt counter follows the receipts', () => {
    beforeEach(async () => {
        enableBilling()
        await seedTestPlans()
    })

    it('upload adds the file size, delete gives it back', async () => {
        const user = await registerUser(app)
        await setSubscription(user.userId, BILLING_STATES.active)

        const first = await uploadReceipt(user.token)
        await uploadReceipt(user.token)
        expect(await counter(user.userId, 'receiptBytes')).toBe(PDF.length * 2)

        await request(app).delete(`/api/v1/receipts/${first.body.data._id}`).set(authHeader(user.token))

        expect(await counter(user.userId, 'receiptBytes')).toBe(PDF.length)
    })

    it('a rejected upload (bytes do not match the declared type) holds no space', async () => {
        const user = await registerUser(app)
        await setSubscription(user.userId, BILLING_STATES.active)

        const res = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(user.token))
            .attach('receipt', Buffer.from('not a pdf at all'), { filename: 'r.pdf', contentType: 'application/pdf' })

        expect(res.status).toBe(400)
        expect((await counter(user.userId, 'receiptBytes')) ?? 0).toBe(0)
    })

    it('a lapsed user is refused before the file is written to disk', async () => {
        const user = await registerUser(app)
        await setSubscription(user.userId, BILLING_STATES.trial_expired)

        const res = await uploadReceipt(user.token)

        expect(res.status).toBe(402)
        expect(fs.existsSync(`${RECEIPT_UPLOAD_ROOT}/${user.userId}`)).toBe(false)
    })
})

describe('sync device ids on the pull side', () => {
    it('a malformed deviceId is a 400 on pull and bootstrap, and a valid one a 200', async () => {
        enableBilling()
        await seedTestPlans()
        const user = await registerUser(app)
        await setSubscription(user.userId, BILLING_STATES.active)

        for (const path of ['/api/v1/sync/pull', '/api/v1/sync/bootstrap']) {
            const bad = await request(app).get(path).query({ deviceId: 'has space' }).set(authHeader(user.token))
            const good = await request(app).get(path).query({ deviceId: 'laptop-1' }).set(authHeader(user.token))

            expect(bad.status).toBe(400)
            expect(good.status).toBe(200)
        }
    })

    it('pulls are never refused for a lapsed user, whatever device they name', async () => {
        enableBilling()
        await seedTestPlans()
        const user = await registerUser(app)
        await setSubscription(user.userId, BILLING_STATES.trial_expired)

        const res = await request(app).get('/api/v1/sync/pull').query({ deviceId: 'anything' }).set(authHeader(user.token))

        expect(res.status).toBe(200)
    })

    it('a push refused because the subscription lapsed is still recorded: entitlement changes the decision, not what is observed', async () => {
        enableBilling()
        await seedTestPlans()
        const user = await registerUser(app)
        await setSubscription(user.userId, BILLING_STATES.trial_expired)

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(user.token))
            .send({ deviceId: 'tablet-9', ops: [] })

        expect(res.status).toBe(402)
        expect(await SyncDevice.countDocuments({ userId: user.userId, deviceId: 'tablet-9' })).toBe(1)
    })

    it('while billing is off a malformed id is ignored, and a valid one is still recorded', async () => {
        const user = await registerUser(app)

        const bad = await request(app).get('/api/v1/sync/pull').query({ deviceId: 'has space' }).set(authHeader(user.token))
        const good = await request(app).get('/api/v1/sync/pull').query({ deviceId: 'laptop-1' }).set(authHeader(user.token))

        expect([bad.status, good.status]).toEqual([200, 200])
        expect(await SyncDevice.countDocuments({ userId: user.userId, deviceId: 'laptop-1' })).toBe(1)
        expect(await SyncDevice.countDocuments({ userId: user.userId })).toBe(1)
    })
})
