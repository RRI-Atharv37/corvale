import fs from 'node:fs'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { RECEIPT_UPLOAD_ROOT } from '@modules/receipts/receiptUtils'
import { authHeader, registerUser, seedUserDirectly, type RegisteredUser } from '@tests/helpers'
import {
    BILLING_STATES,
    createAccountViaApi,
    createExpenseViaApi,
    disableBilling,
    enableBilling,
    getFoodMasterId,
    removeSubscription,
    seedTestPlans,
    seedWorkspace,
    setSubscription,
    type SubscriptionOverrides,
} from '@tests/billingHelpers'

/**
 * M1 - export and backup are never gated, in any subscription state, ever (ROADMAP § *Trial and
 * downgrade semantics*). It is the ethical floor for a finance app and the credibility anchor of
 * the data-ownership positioning: gating export would make that claim a lie. Every route that
 * lets a user take their data out is exercised in every billing state, including no subscription
 * at all, a grandfathered account, an over-quota downgrade, and billing switched off.
 */

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\n%%EOF')

const STATES: Array<[string, SubscriptionOverrides | null]> = [
    ['trialing', BILLING_STATES.trialing],
    ['active (Pro)', BILLING_STATES.active],
    ['active (Plus)', { ...BILLING_STATES.active, planCode: 'plus' }],
    ['past_due, in grace', BILLING_STATES.past_due_in_grace],
    ['past_due, grace elapsed', BILLING_STATES.past_due_grace_elapsed],
    ['trial_expired', BILLING_STATES.trial_expired],
    ['trialing but lapsed', BILLING_STATES.trialing_but_lapsed],
    ['cancelled', BILLING_STATES.cancelled],
    ['cancelling, period elapsed', BILLING_STATES.cancelling_period_elapsed],
    ['free_forever grandfathered', { ...BILLING_STATES.trial_expired, grandfatherKind: 'free_forever' }],
    ['no subscription row', null],
]

let user: RegisteredUser
let receiptId: string

const seedUserData = async (): Promise<void> => {
    await setSubscription(user.userId, BILLING_STATES.active)
    const accountId = await createAccountViaApi(app, user.token)
    const categoryId = await getFoodMasterId(app, user.token)
    await createExpenseViaApi(app, user.token, accountId, categoryId, { title: 'Exportable lunch' })
    const receipt = await request(app)
        .post('/api/v1/receipts')
        .set(authHeader(user.token))
        .attach('receipt', PDF, { filename: 'r.pdf', contentType: 'application/pdf' })
    receiptId = receipt.body.data._id
}

const applyState = async (overrides: SubscriptionOverrides | null): Promise<void> => {
    if (overrides === null) {
        await removeSubscription(user.userId)
    } else {
        await setSubscription(user.userId, overrides)
    }
}

const exportRoutes = (): Array<[string, string]> => [
    ['full backup', '/api/v1/backup/export'],
    ['transactions CSV', '/api/v1/transactions/download'],
    ['legacy income CSV', '/api/v1/income/download'],
    ['legacy expense CSV', '/api/v1/expense/download'],
    ['receipt file', `/api/v1/receipts/${receiptId}`],
    ['sync bootstrap (full snapshot)', '/api/v1/sync/bootstrap'],
    ['sync pull', '/api/v1/sync/pull'],
    ['account deletion impact preview', '/api/v1/auth/account/deletion-impact'],
]

beforeEach(async () => {
    enableBilling()
    await seedTestPlans()
    user = await registerUser(app)
    await seedUserData()
})

afterEach(() => {
    disableBilling()
    if (fs.existsSync(RECEIPT_UPLOAD_ROOT)) {
        fs.rmSync(RECEIPT_UPLOAD_ROOT, { recursive: true, force: true })
    }
})

describe.each(STATES)('export is available while %s', (_name, overrides) => {
    beforeEach(() => applyState(overrides))

    it('every export route answers 200 with the user\'s data', async () => {
        for (const [label, path] of exportRoutes()) {
            const res = await request(app).get(path).set(authHeader(user.token))

            expect(res.status, label).toBe(200)
        }
    })

    it('the transactions CSV actually contains the data, not an empty shell', async () => {
        const res = await request(app).get('/api/v1/transactions/download').set(authHeader(user.token))

        expect(res.text).toContain('Exportable lunch')
    })

    it('the account-erasure route is never billing-gated (a wrong password is 4xx-but-not-402)', async () => {
        const res = await request(app).delete('/api/v1/auth/account').set(authHeader(user.token)).send({ password: 'wrong-password-123' })

        expect(res.status).not.toBe(402)
    })
})

describe('export with billing switched off', () => {
    it('is available too', async () => {
        disableBilling()

        for (const [label, path] of exportRoutes()) {
            const res = await request(app).get(path).set(authHeader(user.token))

            expect(res.status, label).toBe(200)
        }
    })
})

describe('export of workspace data by a member of a lapsed workspace', () => {
    it('a member can still export a workspace whose owner has lapsed', async () => {
        const editor = await seedUserDirectly({ email: 'export-editor@example.com' })
        await setSubscription(editor.userId, BILLING_STATES.trial_expired)
        const workspaceId = await seedWorkspace(user.userId, [{ userId: editor.userId, role: 'editor' }])
        const accountId = await createAccountViaApi(app, user.token, { workspaceId })
        const categoryId = await getFoodMasterId(app, user.token)
        await createExpenseViaApi(app, user.token, accountId, categoryId, { workspaceId, title: 'Shared receipt lunch' })
        await setSubscription(user.userId, BILLING_STATES.trial_expired)

        for (const who of [user, editor]) {
            const csv = await request(app).get('/api/v1/transactions/download').query({ workspaceId }).set(authHeader(who.token))
            expect(csv.status).toBe(200)
            expect(csv.text).toContain('Shared receipt lunch')

            const bootstrap = await request(app).get('/api/v1/sync/bootstrap').query({ workspaceId }).set(authHeader(who.token))
            expect(bootstrap.status).toBe(200)
        }
    })
})

describe('the entitlement snapshot never advertises otherwise', () => {
    it.each(STATES)('canExport is true while %s', async (_name, overrides) => {
        await applyState(overrides)

        const res = await request(app).get('/api/v1/auth/user').set(authHeader(user.token))

        expect(res.body.data.entitlements.canExport).toBe(true)
        expect(res.body.data.entitlements.canRead).toBe(true)
    })
})
