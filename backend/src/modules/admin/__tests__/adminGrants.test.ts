import request from 'supertest'
import type { Application } from 'express'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import defaultApp from '@http/app'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { authHeader, registerUser, type RegisteredUser } from '@tests/helpers'
import {
    BILLING_STATES,
    DAY_MS,
    buildEvent,
    daysFromNow,
    disableBilling,
    enableBilling,
    installFakeBillingProvider,
    postWebhook,
    randomId,
    resetBillingProvider,
    seedTestPlans,
    setSubscription,
} from '@tests/billingHelpers'
import { ADMIN_BASE, bearer, buildAdminApp, disableAdmin, loginAsAdmin, seedAdmin, type SeededAdmin } from '@tests/adminHelpers'
import { AdminAuditLog, AdminSession } from '@modules/admin'
import { Subscription, getUserEntitlements } from '@modules/billing'

/**
 * M7.3 - staff levers: comp, plan override, trial extension, erasure hold. Each writes only the overlay (or
 * Corvale-owned trial state), is capped by role, needs a reason, and leaves an audit row.
 */

const REASON = 'Goodwill after the billing outage'

let app: Application
let support: SeededAdmin
let supportToken: string
let user: RegisteredUser

beforeAll(() => {
    app = buildAdminApp()
})

afterAll(() => {
    disableAdmin()
})

beforeEach(async () => {
    enableBilling()
    await seedTestPlans()
    support = await seedAdmin({ role: 'support' })
    ;({ token: supportToken } = await loginAsAdmin(app, support))
    user = await registerUser(defaultApp)
    await setSubscription(user.userId, BILLING_STATES.trial_expired)
})

afterEach(() => {
    disableBilling()
    resetBillingProvider()
})

const post = (path: string, body: Record<string, unknown> = {}, token: string = supportToken) =>
    request(app).post(`${ADMIN_BASE}/subscribers/${user.userId}${path}`).set(bearer(token)).send(body)

const stored = () => Subscription.findOne({ userId: user.userId }).lean()

const canWriteViaApi = async (): Promise<boolean> =>
    (
        await request(defaultApp)
            .post('/api/v1/accounts')
            .set(authHeader(user.token))
            .send({ name: `probe-${Math.random()}`, type: 'checking', openingBalance: 1 })
    ).status === 201

const compBody = (over: Record<string, unknown> = {}) => ({ kind: 'comp', planCode: 'pro', days: 30, reason: REASON, ...over })

describe('access', () => {
    it('finance cannot grant anything; unauthenticated callers get 401', async () => {
        const finance = await seedAdmin({ role: 'finance' })
        const { token } = await loginAsAdmin(app, finance)

        for (const [path, body] of [
            ['/grant', compBody()],
            ['/grant/revoke', { reason: REASON }],
            ['/trial-extension', { days: 5, reason: REASON }],
            ['/erasure-hold', { days: 5, reason: REASON }],
            ['/erasure-hold/clear', { reason: REASON }],
        ] as const) {
            const res = await post(path, body, token)

            expect(res.status, path).toBe(403)
            expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.FORBIDDEN)
        }
        expect((await request(app).post(`${ADMIN_BASE}/subscribers/${user.userId}/grant`).send(compBody())).status).toBe(401)
    })

    it('does not need a step-up: these are reversible overlays, not money', async () => {
        await AdminSession.updateMany({ adminId: support.id }, { $set: { stepUpAt: null } })

        expect((await post('/grant', compBody())).status).toBe(200)
    })
})

describe('POST /subscribers/:userId/grant - comp', () => {
    it('lets a read-only customer write again, without rewriting the provider state', async () => {
        expect(await canWriteViaApi()).toBe(false)
        const before = await stored()

        const res = await post('/grant', compBody())

        expect(res.status).toBe(200)
        expect(await canWriteViaApi()).toBe(true)
        const after = await stored()
        expect(after?.status).toBe('trial_expired')
        expect(after?.currentPeriodEnd).toEqual(before?.currentPeriodEnd)
        expect(after?.planCode).toBe(before?.planCode)
        expect(after?.adminGrant).toMatchObject({ kind: 'comp', planCode: 'pro' })
        expect(after?.adminGrant?.grantedBy?.toString()).toBe(support.id)
        const until = after!.adminGrant!.until.getTime()
        expect(Math.abs(until - (Date.now() + 30 * DAY_MS))).toBeLessThan(60_000)
    })

    it('does not store the reason on the subscription; it lives in the audit log', async () => {
        await post('/grant', compBody())

        expect(JSON.stringify(await stored())).not.toContain(REASON)
    })

    it('writes an audit row with a sanitised before/after and the reason, and keeps it with no expiry', async () => {
        await post('/grant', compBody())

        const row = await AdminAuditLog.findOne({ action: 'grant.comp' }).lean()
        expect(row?.adminId?.toString()).toBe(support.id)
        expect(row?.adminRole).toBe('support')
        expect(row?.subjectUserId?.toString()).toBe(user.userId)
        expect(row?.subjectSubscriptionId).toBeTruthy()
        expect(row?.reason).toBe(REASON)
        expect(row?.before).toEqual({ adminGrant: null })
        expect(row?.after).toMatchObject({ adminGrant: { kind: 'comp', planCode: 'pro' } })
        expect(row?.expireAt ?? null).toBeNull()
        const raw = JSON.stringify(row)
        expect(raw).not.toContain(`cus_${user.userId}`)
        expect(raw).not.toContain(user.email)
    })

    it('survives a provider webhook that rewrites the subscription', async () => {
        installFakeBillingProvider()
        await setSubscription(user.userId, BILLING_STATES.active)
        await post('/grant', compBody({ planCode: 'pro' }))

        const res = await postWebhook(
            defaultApp,
            buildEvent({
                type: 'subscription.deleted',
                providerCustomerId: `cus_${user.userId}`,
                providerSubscriptionId: `sub_${user.userId}`,
                status: 'cancelled',
                currentPeriodEnd: daysFromNow(-1).toISOString(),
            })
        )

        expect(res.status).toBe(200)
        expect((await stored())?.status).toBe('cancelled')
        expect((await stored())?.adminGrant?.kind).toBe('comp')
        expect(await canWriteViaApi()).toBe(true)
    })

    it('replaces an earlier grant and audits what it replaced', async () => {
        await post('/grant', compBody({ days: 10 }))
        await post('/grant', compBody({ days: 20, planCode: 'plus' }))

        expect((await stored())?.adminGrant?.planCode).toBe('plus')
        const rows = await AdminAuditLog.find({ action: 'grant.comp' }).sort({ at: 1 }).lean()
        expect(rows).toHaveLength(2)
        expect(rows[1].before).toMatchObject({ adminGrant: { kind: 'comp', planCode: 'pro' } })
    })

    it('needs a plan code that exists', async () => {
        for (const planCode of [undefined, 'gold', 5]) {
            expect((await post('/grant', compBody({ planCode }))).status).toBe(400)
        }
        expect(await stored().then((row) => row?.adminGrant ?? null)).toBeNull()
    })
})

describe('caps and validation', () => {
    it('a support admin is capped at 30 days, an owner at 365', async () => {
        expect((await post('/grant', compBody({ days: 31 }))).body.message).toBe(ERROR_MESSAGES.ADMIN.GRANT_CAP_EXCEEDED)
        expect((await post('/grant', compBody({ days: 30 }))).status).toBe(200)

        const owner = await seedAdmin({ role: 'owner' })
        const { token } = await loginAsAdmin(app, owner)
        expect((await post('/grant', compBody({ days: 366 }), token)).body.message).toBe(ERROR_MESSAGES.ADMIN.GRANT_CAP_EXCEEDED)
        expect((await post('/grant', compBody({ days: 365 }), token)).status).toBe(200)
    })

    it.each([0, -1, 1.5, '5', null, undefined, Number.MAX_SAFE_INTEGER])('rejects days = %j', async (days) => {
        const res = await post('/grant', compBody({ days }))

        expect(res.status).toBe(400)
    })

    it('needs a reason of 10-500 characters that holds no email address', async () => {
        for (const reason of [undefined, 'short', 'x'.repeat(501), 'For customer jane@example.com']) {
            expect((await post('/grant', compBody({ reason }))).status).toBe(400)
        }
        expect(await AdminAuditLog.countDocuments({ action: 'grant.comp' })).toBe(0)
    })

    it('rejects an unknown kind', async () => {
        expect((await post('/grant', compBody({ kind: 'free_forever' }))).status).toBe(400)
    })

    it('404s for an unknown user or a user with no subscription row, 400s for a bad id', async () => {
        expect((await request(app).post(`${ADMIN_BASE}/subscribers/${randomId()}/grant`).set(bearer(supportToken)).send(compBody())).status).toBe(404)
        await Subscription.deleteMany({ userId: user.userId })
        const res = await post('/grant', compBody())
        expect(res.status).toBe(404)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.SUBSCRIBER_NOT_FOUND)
        expect((await request(app).post(`${ADMIN_BASE}/subscribers/not-an-id/grant`).set(bearer(supportToken)).send(compBody())).status).toBe(400)
    })
})

describe('POST /subscribers/:userId/grant - plan override', () => {
    beforeEach(async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.active, planCode: 'plus' })
    })

    const overrideBody = (over: Record<string, unknown> = {}) => ({ kind: 'plan_override', days: 30, reason: REASON, ...over })

    it('raises a limit the customer pays for, and only that limit', async () => {
        const before = await getUserEntitlements(user.userId)

        const res = await post('/grant', overrideBody({ limits: { receiptStorageBytes: 5 * 1024 * 1024 } }))

        expect(res.status).toBe(200)
        const after = await getUserEntitlements(user.userId)
        expect(after.limits.receiptStorageBytes).toBe(5 * 1024 * 1024)
        expect(after.limits.syncDevices).toBe(before.limits.syncDevices)
        expect(after.features).toEqual(before.features)
        expect(after.planCode).toBe('plus')
    })

    it('can raise the plan itself', async () => {
        await post('/grant', overrideBody({ planCode: 'pro' }))

        expect(await getUserEntitlements(user.userId)).toMatchObject({ planCode: 'pro' })
    })

    it('audits it as a plan override', async () => {
        await post('/grant', overrideBody({ planCode: 'pro' }))

        expect(await AdminAuditLog.countDocuments({ action: 'grant.plan_override' })).toBe(1)
    })

    it('refuses anything that does not raise what the customer has', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.active, planCode: 'pro' })

        for (const body of [
            overrideBody({ planCode: 'plus' }),
            overrideBody({ planCode: 'pro' }),
            overrideBody({ limits: { receiptStorageBytes: 1 } }),
            overrideBody({ limits: { receiptStorageBytes: 10 * 1024 * 1024 } }),
            overrideBody({}),
        ]) {
            const res = await post('/grant', body)

            expect(res.status, JSON.stringify(body)).toBe(400)
        }
        expect((await stored())?.adminGrant ?? null).toBeNull()
    })

    it('rejects limits that are not whole non-negative numbers or null, or name an unknown limit', async () => {
        for (const limits of [{ receiptStorageBytes: -5 }, { receiptStorageBytes: 1.5 }, { receiptStorageBytes: 'lots' }, { madeUp: 5 }, []]) {
            expect((await post('/grant', overrideBody({ limits }))).status, JSON.stringify(limits)).toBe(400)
        }
    })

    it('does not make a read-only customer writable', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.trial_expired, planCode: 'plus' })

        await post('/grant', overrideBody({ planCode: 'pro' }))

        expect(await canWriteViaApi()).toBe(false)
    })
})

describe('POST /subscribers/:userId/grant/revoke', () => {
    it('removes the grant, the access it gave, and audits it', async () => {
        await post('/grant', compBody())
        expect(await canWriteViaApi()).toBe(true)

        const res = await post('/grant/revoke', { reason: REASON })

        expect(res.status).toBe(200)
        expect((await stored())?.adminGrant ?? null).toBeNull()
        expect(await canWriteViaApi()).toBe(false)
        const row = await AdminAuditLog.findOne({ action: 'grant.revoked' }).lean()
        expect(row?.before).toMatchObject({ adminGrant: { kind: 'comp' } })
        expect(row?.after).toEqual({ adminGrant: null })
    })

    it('404s when there is nothing to revoke', async () => {
        const res = await post('/grant/revoke', { reason: REASON })

        expect(res.status).toBe(404)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.NO_GRANT)
    })

    it('needs a reason', async () => {
        await post('/grant', compBody())

        expect((await post('/grant/revoke', {})).status).toBe(400)
        expect((await stored())?.adminGrant).toBeTruthy()
    })
})

describe('POST /subscribers/:userId/trial-extension', () => {
    beforeEach(async () => {
        await Subscription.updateOne({ userId: user.userId }, { $set: { providerCustomerId: null, providerSubscriptionId: null } })
    })

    it('reopens an expired trial for N days from now and clears the lapse', async () => {
        await Subscription.updateOne({ userId: user.userId }, { $set: { lapsedAt: daysFromNow(-5), retentionStage: 'notice', retentionStageAt: daysFromNow(-5) } })

        const res = await post('/trial-extension', { days: 14, reason: REASON })

        expect(res.status).toBe(200)
        const row = await stored()
        expect(row?.status).toBe('trialing')
        expect(Math.abs(row!.trialEndsAt!.getTime() - (Date.now() + 14 * DAY_MS))).toBeLessThan(60_000)
        expect(row?.lapsedAt ?? null).toBeNull()
        expect(row?.retentionStage ?? null).toBeNull()
        expect(await canWriteViaApi()).toBe(true)
    })

    it('adds N days to a trial that is still running', async () => {
        const endsAt = daysFromNow(5)
        await setSubscription(user.userId, { ...BILLING_STATES.trialing, trialEndsAt: endsAt, providerCustomerId: null, providerSubscriptionId: null })

        await post('/trial-extension', { days: 10, reason: REASON })

        expect((await stored())?.trialEndsAt?.getTime()).toBe(endsAt.getTime() + 10 * DAY_MS)
    })

    it('refuses a subscription that is linked to the payment provider, or not a trial at all', async () => {
        await setSubscription(user.userId, BILLING_STATES.trial_expired)
        let res = await post('/trial-extension', { days: 5, reason: REASON })
        expect(res.status).toBe(400)
        expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.TRIAL_NOT_EXTENDABLE)

        await setSubscription(user.userId, { ...BILLING_STATES.active, providerCustomerId: null, providerSubscriptionId: null })
        res = await post('/trial-extension', { days: 5, reason: REASON })
        expect(res.status).toBe(400)
    })

    it('caps the length: 30 days for support, 365 for an owner, and the total from now', async () => {
        expect((await post('/trial-extension', { days: 31, reason: REASON })).body.message).toBe(ERROR_MESSAGES.ADMIN.GRANT_CAP_EXCEEDED)

        await setSubscription(user.userId, { ...BILLING_STATES.trialing, trialEndsAt: daysFromNow(25), providerCustomerId: null, providerSubscriptionId: null })
        expect((await post('/trial-extension', { days: 10, reason: REASON })).body.message).toBe(ERROR_MESSAGES.ADMIN.GRANT_CAP_EXCEEDED)
    })

    it('audits before and after with the dates', async () => {
        await post('/trial-extension', { days: 7, reason: REASON })

        const row = await AdminAuditLog.findOne({ action: 'trial.extended' }).lean()
        expect(row?.before).toMatchObject({ status: 'trial_expired' })
        expect(row?.after).toMatchObject({ status: 'trialing' })
        expect(typeof (row?.after as { trialEndsAt: string }).trialEndsAt).toBe('string')
        expect(row?.reason).toBe(REASON)
    })

    it.each([0, -3, 2.5, 'x'])('rejects days = %j', async (days) => {
        expect((await post('/trial-extension', { days, reason: REASON })).status).toBe(400)
    })
})

describe('erasure hold', () => {
    it('sets a hold for N days and clears it, each audited', async () => {
        const res = await post('/erasure-hold', { days: 20, reason: REASON })

        expect(res.status).toBe(200)
        const held = await stored()
        expect(Math.abs(held!.retentionHoldUntil!.getTime() - (Date.now() + 20 * DAY_MS))).toBeLessThan(60_000)
        expect(await AdminAuditLog.countDocuments({ action: 'erasure.hold_set' })).toBe(1)

        const cleared = await post('/erasure-hold/clear', { reason: REASON })

        expect(cleared.status).toBe(200)
        expect((await stored())?.retentionHoldUntil ?? null).toBeNull()
        expect(await AdminAuditLog.countDocuments({ action: 'erasure.hold_cleared' })).toBe(1)
    })

    it('a hold changes nothing about what the customer may do', async () => {
        await post('/erasure-hold', { days: 20, reason: REASON })

        expect(await canWriteViaApi()).toBe(false)
        expect((await stored())?.status).toBe('trial_expired')
    })

    it('is capped: 30 days for support, 90 for an owner', async () => {
        expect((await post('/erasure-hold', { days: 31, reason: REASON })).body.message).toBe(ERROR_MESSAGES.ADMIN.GRANT_CAP_EXCEEDED)

        const owner = await seedAdmin({ role: 'owner' })
        const { token } = await loginAsAdmin(app, owner)
        expect((await post('/erasure-hold', { days: 91, reason: REASON }, token)).status).toBe(400)
        expect((await post('/erasure-hold', { days: 90, reason: REASON }, token)).status).toBe(200)
    })

    it('clearing a hold that does not exist is a 404', async () => {
        expect((await post('/erasure-hold/clear', { reason: REASON })).status).toBe(404)
    })

    it.each([0, -1, 1.5, 'x'])('rejects days = %j', async (days) => {
        expect((await post('/erasure-hold', { days, reason: REASON })).status).toBe(400)
    })
})

describe('the detail view reflects the overlay', () => {
    it('shows the grant, the hold, the audit history and the resolved entitlements', async () => {
        await post('/grant', compBody())
        await post('/erasure-hold', { days: 10, reason: REASON })

        const detail = (await request(app).get(`${ADMIN_BASE}/subscribers/${user.userId}`).set(bearer(supportToken))).body.data

        expect(detail.subscription.adminGrant).toMatchObject({ kind: 'comp', planCode: 'pro' })
        expect(JSON.stringify(detail.subscription.adminGrant)).not.toContain(REASON)
        expect(detail.subscription.retentionHoldUntil).toBeTruthy()
        expect(detail.entitlements).toMatchObject({ canWrite: true, status: 'active', planCode: 'pro' })
        expect(detail.readOnly).toMatchObject({ canWrite: true, code: 'admin_comp' })
        expect(detail.adminHistory.map((entry: { action: string }) => entry.action)).toEqual(expect.arrayContaining(['grant.comp', 'erasure.hold_set']))
        expect(detail.erasure.held).toBe(true)
    })
})
