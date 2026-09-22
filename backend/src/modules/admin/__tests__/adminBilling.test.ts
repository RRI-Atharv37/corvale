import request from 'supertest'
import type { Application } from 'express'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import defaultApp from '@http/app'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { registerUser, type RegisteredUser } from '@tests/helpers'
import {
    BILLING_STATES,
    createFakeBillingProvider,
    daysFromNow,
    disableBilling,
    enableBilling,
    randomId,
    resetBillingProvider,
    seedTestPlans,
    setSubscription,
} from '@tests/billingHelpers'
import { ADMIN_BASE, bearer, buildAdminApp, disableAdmin, loginAsAdmin, seedAdmin, type SeededAdmin } from '@tests/adminHelpers'
import { AdminAuditLog, AdminSession } from '@modules/admin'
import { BillingEvent, Subscription, setBillingProvider } from '@modules/billing'

/**
 * M7.5 - provider actions: refund, cancel, resync, recompute usage, device revoke, and the event-replay
 * stretch. Refund/cancel/resync/replay are finance+owner (`money.write`); recompute-usage and device revoke
 * are support+owner (`grants.write`), matching the other operational repair actions. Only refund, cancel-now
 * and replay need a fresh step-up - the plan's step-up table names them, not cancel-at-period-end or the
 * read-only resync preview.
 */

const REASON = 'Customer support ticket #4821, confirmed with the subscriber'

let app: Application
let owner: SeededAdmin
let ownerToken: string
let user: RegisteredUser
let fake: ReturnType<typeof createFakeBillingProvider>

beforeAll(() => {
    app = buildAdminApp()
})

afterAll(() => {
    disableAdmin()
})

beforeEach(async () => {
    enableBilling()
    await seedTestPlans()
    fake = createFakeBillingProvider()
    setBillingProvider(fake.provider)
    owner = await seedAdmin({ role: 'owner' })
    ;({ token: ownerToken } = await loginAsAdmin(app, owner))
    user = await registerUser(defaultApp)
    await setSubscription(user.userId, { ...BILLING_STATES.active, providerCustomerId: `cus_${user.userId}`, providerSubscriptionId: `sub_${user.userId}` })
})

afterEach(() => {
    disableBilling()
    resetBillingProvider()
})

const post = (path: string, body: Record<string, unknown> = {}, token: string = ownerToken) =>
    request(app).post(`${ADMIN_BASE}/subscribers/${user.userId}${path}`).set(bearer(token)).send(body)

const get = (path: string, token: string = ownerToken) => request(app).get(`${ADMIN_BASE}/subscribers/${user.userId}${path}`).set(bearer(token))

const stored = () => Subscription.findOne({ userId: user.userId }).lean()

const seedInvoice = (over: Partial<(typeof fake.invoices)[number]> = {}) => {
    const invoice = { id: 'inv_1', issuedAt: daysFromNow(-2), total: 1200, currency: 'USD', status: 'paid' as const, url: null, ...over }
    fake.invoices.push(invoice)
    return invoice
}

describe('access', () => {
    it('finance can reach money actions but not recompute-usage/device-revoke; support is the reverse; both need step-up on the gated ones', async () => {
        const finance = await seedAdmin({ role: 'finance' })
        const { token: financeToken } = await loginAsAdmin(app, finance)
        const support = await seedAdmin({ role: 'support' })
        const { token: supportToken } = await loginAsAdmin(app, support)

        expect((await post('/cancel', { reason: REASON }, financeToken)).status).toBe(202)
        expect((await post('/cancel', { reason: REASON }, supportToken)).status).toBe(403)
        expect((await post('/recompute-usage', { reason: REASON }, supportToken)).status).toBe(200)
        expect((await post('/recompute-usage', { reason: REASON }, financeToken)).status).toBe(403)

        expect((await request(app).post(`${ADMIN_BASE}/subscribers/${user.userId}/cancel`).send({})).status).toBe(401)
    })
})

describe('GET /subscribers/:userId/invoices', () => {
    it('lists the live invoices for the refund picker', async () => {
        const invoice = seedInvoice()

        const res = await get('/invoices')

        expect(res.status).toBe(200)
        expect(res.body.data.invoices).toEqual([{ ...invoice, issuedAt: invoice.issuedAt.toISOString() }])
    })

    it('refuses a subscriber with no live payment-provider link', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.active, providerCustomerId: null, providerSubscriptionId: null })

        expect((await get('/invoices')).body.message).toBe(ERROR_MESSAGES.ADMIN.NOT_PROVIDER_LINKED)
    })
})

describe('POST /subscribers/:userId/refund', () => {
    it('needs a fresh step-up', async () => {
        seedInvoice()
        await AdminSession.updateMany({ adminId: owner.id }, { $set: { stepUpAt: null } })

        const res = await post('/refund', { providerInvoiceId: 'inv_1', confirmAmountMinor: 1200, reason: REASON })

        expect(res.status).toBe(403)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.STEP_UP_REQUIRED)
    })

    it('refunds the typed amount of a live paid invoice and audits it as money', async () => {
        seedInvoice()

        const res = await post('/refund', { providerInvoiceId: 'inv_1', confirmAmountMinor: 1200, reason: REASON })

        expect(res.status).toBe(202)
        expect(res.body.data).toEqual({ requested: true })
        expect(fake.calls.refundInvoice).toEqual([{ providerInvoiceId: 'inv_1', amountMinor: 1200 }])

        const row = await AdminAuditLog.findOne({ action: 'billing.refund' }).lean()
        expect(row?.amountMinor).toBe(1200)
        expect(row?.currency).toBe('USD')
        expect(row?.expireAt).toBeNull()
    })

    it('refuses an invoice not on the live list, a non-paid invoice, and a mismatched amount', async () => {
        seedInvoice({ id: 'inv_paid', status: 'paid', total: 500 })
        seedInvoice({ id: 'inv_pending', status: 'pending', total: 800 })

        expect((await post('/refund', { providerInvoiceId: 'inv_missing', confirmAmountMinor: 500, reason: REASON })).status).toBe(404)
        expect((await post('/refund', { providerInvoiceId: 'inv_pending', confirmAmountMinor: 800, reason: REASON })).body.message).toBe(
            ERROR_MESSAGES.ADMIN.INVOICE_NOT_REFUNDABLE
        )
        expect((await post('/refund', { providerInvoiceId: 'inv_paid', confirmAmountMinor: 499, reason: REASON })).body.message).toBe(
            ERROR_MESSAGES.ADMIN.REFUND_AMOUNT_MISMATCH
        )
        expect(fake.calls.refundInvoice).toEqual([])
    })

    it('refuses a subscriber with no live payment-provider link', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.active, providerCustomerId: null, providerSubscriptionId: null })

        const res = await post('/refund', { providerInvoiceId: 'inv_1', confirmAmountMinor: 500, reason: REASON })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.NOT_PROVIDER_LINKED)
    })
})

describe('cancel', () => {
    it('at period end asks the provider without immediate, and does not need a step-up', async () => {
        await AdminSession.updateMany({ adminId: owner.id }, { $set: { stepUpAt: null } })

        const res = await post('/cancel', { reason: REASON })

        expect(res.status).toBe(202)
        expect(fake.calls.cancelSubscription).toEqual([{ providerSubscriptionId: `sub_${user.userId}`, immediate: false }])
        expect(await AdminAuditLog.countDocuments({ action: 'billing.cancel_at_period_end' })).toBe(1)
    })

    it('now asks the provider with immediate, and needs a fresh step-up', async () => {
        await AdminSession.updateMany({ adminId: owner.id }, { $set: { stepUpAt: null } })
        expect((await post('/cancel/now', { reason: REASON })).status).toBe(403)

        await AdminSession.updateMany({ adminId: owner.id }, { $set: { stepUpAt: new Date() } })
        const res = await post('/cancel/now', { reason: REASON })

        expect(res.status).toBe(202)
        expect(fake.calls.cancelSubscription).toEqual([{ providerSubscriptionId: `sub_${user.userId}`, immediate: true }])
        expect(await AdminAuditLog.countDocuments({ action: 'billing.cancel_now' })).toBe(1)
    })
})

describe('resync', () => {
    it('previews the drift between the local row and the live provider snapshot, without writing anything', async () => {
        fake.remote.push({ providerSubscriptionId: `sub_${user.userId}`, status: 'past_due', planCode: 'plus', updatedAt: new Date() })

        const res = await get('/resync/preview')

        expect(res.status).toBe(200)
        expect(res.body.data.differences).toEqual(
            expect.arrayContaining([
                { field: 'status', local: 'active', remote: 'past_due' },
                { field: 'planCode', local: 'pro', remote: 'plus' },
            ])
        )
        expect((await stored())?.status).toBe('active')
    })

    it('applies exactly the differing fields and audits before/after', async () => {
        fake.remote.push({ providerSubscriptionId: `sub_${user.userId}`, status: 'past_due', updatedAt: new Date() })

        const res = await post('/resync/apply', { reason: REASON })

        expect(res.status).toBe(200)
        expect(res.body.data.fields).toEqual(['status'])
        expect((await stored())?.status).toBe('past_due')
        expect((await stored())?.planCode).toBe('pro')

        const row = await AdminAuditLog.findOne({ action: 'billing.resync' }).lean()
        expect(row?.before).toEqual({ status: 'active' })
        expect(row?.after).toEqual({ status: 'past_due' })
    })

    it('refuses when nothing differs, and when the provider no longer has the subscription', async () => {
        fake.remote.push({ providerSubscriptionId: `sub_${user.userId}`, status: 'active', updatedAt: new Date() })
        expect((await post('/resync/apply', { reason: REASON })).body.message).toBe(ERROR_MESSAGES.ADMIN.NO_DIFFERENCE)

        fake.remote.length = 0
        const res = await post('/resync/apply', { reason: REASON })
        expect(res.status).toBe(404)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.SNAPSHOT_UNAVAILABLE)
    })
})

describe('POST /subscribers/:userId/recompute-usage', () => {
    it('recomputes without needing a provider link', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.active, providerCustomerId: null, providerSubscriptionId: null })

        const res = await post('/recompute-usage', { reason: REASON })

        expect(res.status).toBe(200)
        expect(res.body.data).toEqual({ recomputed: true, workspacesRecomputed: 0 })
        expect(await AdminAuditLog.countDocuments({ action: 'billing.usage_recomputed' })).toBe(1)
    })
})

describe('device revoke', () => {
    it('404s a ref that matches no device of this user', async () => {
        expect((await post('/devices/deadbeef/revoke', { reason: REASON })).status).toBe(404)
    })

    it('409s a ref that matches more than one of this user\'s devices', async () => {
        const { SyncDevice } = await import('@modules/billing')
        await SyncDevice.create({ userId: user.userId, deviceId: 'aaaaaaaa1111111111111111', kind: 'web', firstSeenAt: new Date(), lastSeenAt: new Date() })
        await SyncDevice.create({ userId: user.userId, deviceId: 'aaaaaaaa2222222222222222', kind: 'desktop', firstSeenAt: new Date(), lastSeenAt: new Date() })

        const res = await post('/devices/aaaaaaaa/revoke', { reason: REASON })

        expect(res.status).toBe(409)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.DEVICE_REF_AMBIGUOUS)
    })

    it('revokes the one device the ref resolves to', async () => {
        const { SyncDevice } = await import('@modules/billing')
        const device = await SyncDevice.create({ userId: user.userId, deviceId: 'cccccccc3333333333333333', kind: 'web', firstSeenAt: new Date(), lastSeenAt: new Date() })

        const res = await post(`/devices/${device.deviceId.slice(0, 8)}/revoke`, { reason: REASON })

        expect(res.status).toBe(200)
        expect(await SyncDevice.findOne({ deviceId: device.deviceId })).toBeNull()
        expect(await AdminAuditLog.countDocuments({ action: 'device.revoked' })).toBe(1)
    })

    it('needs a valid 8-character reference', async () => {
        expect((await post('/devices/not-hex/revoke', { reason: REASON })).status).toBe(400)
    })
})

describe('POST /billing-events/:eventId/replay', () => {
    const post_ = (path: string, body: Record<string, unknown>, token: string = ownerToken) =>
        request(app).post(`${ADMIN_BASE}${path}`).set(bearer(token)).send(body)

    it('needs a fresh step-up', async () => {
        const event = await BillingEvent.create({
            providerEventId: 'evt_admin_replay',
            type: 'subscription.updated',
            occurredAt: new Date(),
            payload: { providerSubscriptionId: `sub_${user.userId}` },
            error: 'earlier failure',
        })
        await AdminSession.updateMany({ adminId: owner.id }, { $set: { stepUpAt: null } })

        const res = await post_(`/billing-events/${event._id.toString()}/replay`, { reason: REASON })

        expect(res.status).toBe(403)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.STEP_UP_REQUIRED)
    })

    it('replays an eligible event and audits it with no subject', async () => {
        const event = await BillingEvent.create({
            providerEventId: 'evt_admin_replay_2',
            type: 'subscription.updated',
            occurredAt: new Date(),
            payload: { providerSubscriptionId: `sub_${user.userId}`, status: 'past_due' },
            error: 'earlier failure',
        })

        const res = await post_(`/billing-events/${event._id.toString()}/replay`, { reason: REASON })

        expect(res.status).toBe(200)
        expect(res.body.data).toEqual({ status: 'applied' })
        expect((await stored())?.status).toBe('past_due')
        const row = await AdminAuditLog.findOne({ action: 'billing_event.replayed' }).lean()
        expect(row?.subjectUserId).toBeNull()
    })

    it('404s an id that is not an unapplied, errored event', async () => {
        const res = await post_(`/billing-events/${randomId()}/replay`, { reason: REASON })

        expect(res.status).toBe(404)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.EVENT_NOT_REPLAYABLE)
    })
})
