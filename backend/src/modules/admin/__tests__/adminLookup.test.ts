import request from 'supertest'
import type { Application } from 'express'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import defaultApp from '@http/app'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { registerUser, type RegisteredUser } from '@tests/helpers'
import {
    BILLING_STATES,
    DAY_MS,
    daysFromNow,
    disableBilling,
    enableBilling,
    randomId,
    seedTestPlans,
    seedWorkspace,
    setSubscription,
} from '@tests/billingHelpers'
import { ADMIN_BASE, bearer, buildAdminApp, disableAdmin, loginAsAdmin, seedAdmin, type SeededAdmin } from '@tests/adminHelpers'
import { AdminAuditLog } from '@modules/admin'
import { BillingEvent, Subscription, SyncDevice, UsageCounter } from '@modules/billing'
import { User } from '@modules/users'

/**
 * M7.2 - the read side: exact-match lookup (so the tool cannot be used to harvest addresses), a masked
 * cross-user list, and the full per-subscriber detail with a "why is this user read-only?" line.
 */

let app: Application
let admin: SeededAdmin
let token: string

beforeAll(() => {
    app = buildAdminApp()
})

afterAll(() => {
    disableAdmin()
})

beforeEach(async () => {
    enableBilling()
    await seedTestPlans()
    admin = await seedAdmin({ role: 'support' })
    ;({ token } = await loginAsAdmin(app, admin))
})

afterEach(() => {
    disableBilling()
})

const seedSubscriber = async (
    email: string,
    state: keyof typeof BILLING_STATES = 'active',
    extra: Record<string, unknown> = {}
): Promise<RegisteredUser> => {
    const user = await registerUser(defaultApp, { email })
    await setSubscription(user.userId, BILLING_STATES[state])
    if (Object.keys(extra).length > 0) await Subscription.updateOne({ userId: user.userId }, { $set: extra })
    return user
}

const get = (path: string, as: string = token) => request(app).get(`${ADMIN_BASE}${path}`).set(bearer(as))

describe('access', () => {
    it.each(['support', 'finance', 'owner'] as const)('a %s admin can read subscribers', async (role) => {
        const other = await seedAdmin({ role })
        const session = await loginAsAdmin(app, other)

        expect((await get('/subscribers', session.token)).status).toBe(200)
    })

    it('needs an admin token', async () => {
        expect((await request(app).get(`${ADMIN_BASE}/subscribers`)).status).toBe(401)
        expect((await request(app).get(`${ADMIN_BASE}/subscribers/lookup?q=a@b.co`)).status).toBe(401)
        expect((await request(app).get(`${ADMIN_BASE}/subscribers/${randomId()}`)).status).toBe(401)
    })
})

describe('GET /subscribers/lookup - exact match only', () => {
    it('finds a subscriber by email, case-insensitively, with the email masked', async () => {
        const user = await seedSubscriber('jane.doe@example.com')

        const res = await get(`/subscribers/lookup?q=${encodeURIComponent('  Jane.Doe@Example.com ')}`)

        expect(res.status).toBe(200)
        expect(res.body.data.subscribers).toHaveLength(1)
        expect(res.body.data.subscribers[0].userId).toBe(user.userId)
        expect(res.body.data.subscribers[0].email).toBe('j***@example.com')
        expect(JSON.stringify(res.body)).not.toContain('jane.doe@example.com')
    })

    it('finds a subscriber by user id, provider customer id and provider subscription id', async () => {
        const user = await seedSubscriber('jane.doe@example.com')

        for (const q of [user.userId, `cus_${user.userId}`, `sub_${user.userId}`]) {
            const res = await get(`/subscribers/lookup?q=${encodeURIComponent(q)}`)

            expect(res.status, q).toBe(200)
            expect(res.body.data.subscribers.map((s: { userId: string }) => s.userId), q).toEqual([user.userId])
        }
    })

    it('never matches a partial email, a prefix, a domain, or a regular expression', async () => {
        await seedSubscriber('jane.doe@example.com')
        await seedSubscriber('john.roe@example.com')

        for (const q of ['jane', 'jane.doe', '@example.com', 'example.com', 'jane.doe@example', '.*', '.*@example.com', '^jane', 'j*']) {
            const res = await get(`/subscribers/lookup?q=${encodeURIComponent(q)}`)

            expect(res.status, q).toBe(200)
            expect(res.body.data.subscribers, q).toEqual([])
        }
    })

    it('does not match a partial provider id', async () => {
        const user = await seedSubscriber('jane.doe@example.com')

        const res = await get(`/subscribers/lookup?q=${encodeURIComponent(`sub_${user.userId}`.slice(0, 12))}`)

        expect(res.body.data.subscribers).toEqual([])
    })

    it('a user with no subscription row is still found', async () => {
        const user = await seedSubscriber('jane.doe@example.com')
        await Subscription.deleteMany({ userId: user.userId })

        const res = await get('/subscribers/lookup?q=jane.doe@example.com')

        expect(res.body.data.subscribers).toHaveLength(1)
        expect(res.body.data.subscribers[0]).toMatchObject({ planCode: null, status: null, resolvedStatus: 'none', canWrite: false })
    })

    it('rejects a missing, empty, oversized or non-string query', async () => {
        for (const path of ['/subscribers/lookup', '/subscribers/lookup?q=', `/subscribers/lookup?q=${'a'.repeat(300)}`, '/subscribers/lookup?q=a&q=b']) {
            const res = await get(path)

            expect(res.status, path).toBe(400)
            expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.INVALID_QUERY)
        }
    })

    it('does not treat a query object as an operator', async () => {
        await seedSubscriber('jane.doe@example.com')

        const res = await request(app).get(`${ADMIN_BASE}/subscribers/lookup?q[$ne]=x`).set(bearer(token))

        expect([200, 400]).toContain(res.status)
        expect(res.body.data?.subscribers ?? []).toEqual([])
    })
})

describe('GET /subscribers - masked list with filters', () => {
    beforeEach(async () => {
        await seedSubscriber('one@example.com', 'active')
        await seedSubscriber('two@example.com', 'trialing')
        await seedSubscriber('three@example.com', 'trial_expired')
        await seedSubscriber('four@example.com', 'past_due_in_grace', { dunningStage: 'payment_failed' })
        await seedSubscriber('five@example.com', 'active', { grandfatherKind: 'free_forever', providerCustomerId: null, providerSubscriptionId: null })
    })

    const list = async (query = '') => (await get(`/subscribers${query}`)).body.data

    it('returns every subscriber with masked emails and masked provider ids only', async () => {
        const res = await get('/subscribers')

        expect(res.status).toBe(200)
        expect(res.body.data.subscribers).toHaveLength(5)
        expect(res.body.data.total).toBe(5)
        const raw = JSON.stringify(res.body)
        for (const banned of ['one@example.com', 'two@example.com', 'cus_', 'sub_']) expect(raw).not.toContain(banned)
        expect(res.body.data.subscribers[0].email).toMatch(/^[a-z]\*\*\*@example\.com$/)
    })

    it('filters by stored status', async () => {
        expect((await list('?status=trialing')).subscribers).toHaveLength(1)
        expect((await list('?status=active')).subscribers).toHaveLength(2)
    })

    it('filters by plan and grandfather kind', async () => {
        await Subscription.updateOne({ status: 'trialing' }, { $set: { planCode: 'plus' } })

        expect((await list('?plan=plus')).subscribers).toHaveLength(1)
        expect((await list('?grandfatherKind=free_forever')).subscribers).toHaveLength(1)
    })

    it('filters by dunning stage and retention stage', async () => {
        await Subscription.updateOne({ status: 'trial_expired' }, { $set: { retentionStage: 'notice' } })

        expect((await list('?dunningStage=payment_failed')).subscribers).toHaveLength(1)
        expect((await list('?retentionStage=notice')).subscribers).toHaveLength(1)
    })

    it('filters by provider link', async () => {
        expect((await list('?providerLinked=false')).subscribers).toHaveLength(1)
        expect((await list('?providerLinked=true')).subscribers).toHaveLength(4)
    })

    it('filters trials ending within N days', async () => {
        await Subscription.updateOne({ status: 'trialing' }, { $set: { trialEndsAt: daysFromNow(3) } })

        expect((await list('?trialEndingWithinDays=7')).subscribers).toHaveLength(1)
        expect((await list('?trialEndingWithinDays=2')).subscribers).toHaveLength(0)
    })

    it('filters subscribers with an active admin grant', async () => {
        await Subscription.updateOne({ status: 'active', grandfatherKind: null }, { $set: { adminGrant: { kind: 'comp', planCode: 'pro', until: new Date(Date.now() + DAY_MS), grantedBy: admin.id, grantedAt: new Date() } } })

        expect((await list('?hasAdminGrant=true')).subscribers).toHaveLength(1)
        expect((await list('?hasAdminGrant=false')).subscribers).toHaveLength(4)
    })

    it('paginates and reports the total', async () => {
        const first = await list('?limit=2&page=1')
        const third = await list('?limit=2&page=3')

        expect(first.subscribers).toHaveLength(2)
        expect(first.total).toBe(5)
        expect(third.subscribers).toHaveLength(1)
        expect(new Set([...first.subscribers, ...third.subscribers].map((s: { userId: string }) => s.userId)).size).toBe(3)
    })

    it.each(['?status=weird', '?plan=gold', '?dunningStage=x', '?retentionStage=x', '?grandfatherKind=x', '?providerLinked=maybe', '?limit=101', '?limit=0', '?page=0', '?trialEndingWithinDays=-1', '?trialEndingWithinDays=abc'])(
        'rejects %s',
        async (query) => {
            const res = await get(`/subscribers${query}`)

            expect(res.status).toBe(400)
            expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.INVALID_QUERY)
        }
    )

    it('has no substring or free-text search parameter', async () => {
        const res = await get('/subscribers?search=one@example.com&email=one')

        expect(res.body.data.subscribers).toHaveLength(5)
    })

    it('reports the derived status and canWrite, not just the stored status', async () => {
        await Subscription.updateOne({ status: 'trialing' }, { $set: { trialEndsAt: daysFromNow(-1) } })

        const { subscribers } = await list('?status=trialing')

        expect(subscribers[0]).toMatchObject({ status: 'trialing', resolvedStatus: 'trial_expired', canWrite: false })
    })
})

describe('GET /subscribers/:userId - detail', () => {
    let user: RegisteredUser

    beforeEach(async () => {
        user = await seedSubscriber('jane.doe@example.com', 'active')
    })

    it('returns exactly the allowed sections', async () => {
        const res = await get(`/subscribers/${user.userId}`)

        expect(res.status).toBe(200)
        expect(Object.keys(res.body.data).sort()).toEqual(
            ['account', 'adminHistory', 'billingEvents', 'devices', 'entitlements', 'erasure', 'legal', 'readOnly', 'subscription', 'usage', 'workspaces'].sort()
        )
    })

    it('shows the full email, the legal evidence and the subscription with its provider ids', async () => {
        const { account, legal, subscription } = (await get(`/subscribers/${user.userId}`)).body.data

        expect(account).toMatchObject({ userId: user.userId, email: 'jane.doe@example.com', isEmailVerified: true })
        expect(legal.ageAttested).toBe(true)
        expect(legal.termsVersion).toBeTruthy()
        expect(subscription).toMatchObject({ planCode: 'pro', status: 'active', providerCustomerId: `cus_${user.userId}`, providerSubscriptionId: `sub_${user.userId}` })
    })

    it('never exposes credentials, tokens, preferences or the name', async () => {
        await User.updateOne({ _id: user.userId }, { $set: { fullName: 'Distinctive Fullname' } })

        const raw = JSON.stringify((await get(`/subscribers/${user.userId}`)).body)

        for (const banned of ['password', 'tokenVersion', 'passwordResetTokenHash', 'emailVerificationTokenHash', 'Distinctive Fullname', 'timezone', 'preferredCurrency', 'exchangeRates']) {
            expect(raw, banned).not.toContain(banned)
        }
    })

    it('resolves entitlements and plan limits', async () => {
        const { entitlements } = (await get(`/subscribers/${user.userId}`)).body.data

        expect(entitlements).toMatchObject({ status: 'active', planCode: 'pro', canWrite: true, canSyncPush: true })
        expect(entitlements.limits).toEqual({ receiptStorageBytes: 10 * 1024 * 1024, syncDevices: null, workspaceMembers: null })
    })

    it('explains why a lapsed user is read-only, in plain language', async () => {
        await setSubscription(user.userId, BILLING_STATES.trial_expired)

        const { readOnly, entitlements } = (await get(`/subscribers/${user.userId}`)).body.data

        expect(entitlements.canWrite).toBe(false)
        expect(readOnly).toMatchObject({ canWrite: false, code: 'trial_expired' })
        expect(readOnly.message).toContain('export')
    })

    it('shows usage against the plan limits, and devices without their names', async () => {
        await UsageCounter.create({ userId: user.userId, resource: 'receiptBytes', value: 2048 })
        await SyncDevice.create({ userId: user.userId, deviceId: 'abcdef0123456789abcdef0123456789', kind: 'desktop', name: 'Jane private laptop', firstSeenAt: new Date(), lastSeenAt: new Date() })

        const { usage, devices } = (await get(`/subscribers/${user.userId}`)).body.data

        expect(usage.receiptBytes).toEqual({ used: 2048, limit: 10 * 1024 * 1024 })
        expect(usage.syncDevices).toEqual({ used: 1, limit: null })
        expect(devices).toEqual([expect.objectContaining({ deviceRef: 'abcdef01', kind: 'desktop', canPush: true })])
        expect(JSON.stringify(devices)).not.toContain('private laptop')
    })

    it('lists owned workspaces as ids and seat counts, never names', async () => {
        const other = await registerUser(defaultApp, { email: 'other@example.com' })
        const workspaceId = await seedWorkspace(user.userId, [{ userId: other.userId, role: 'editor' }], 'Family budget secrets')

        const { workspaces } = (await get(`/subscribers/${user.userId}`)).body.data

        expect(workspaces).toEqual([{ id: workspaceId, seatCount: 2 }])
        expect(JSON.stringify(workspaces)).not.toContain('Family budget')
    })

    it('shows this subscriber\'s billing events, minimised, newest first', async () => {
        const make = (n: number, extra: Record<string, unknown> = {}) =>
            BillingEvent.create({
                providerEventId: `evt_${n}`,
                type: 'payment.succeeded',
                occurredAt: new Date(Date.now() - n * DAY_MS),
                processedAt: new Date(),
                payload: { providerCustomerId: `cus_${user.userId}`, providerSubscriptionId: `sub_${user.userId}`, total: 900, currency: 'USD', userEmail: 'leak@example.com', ...extra },
            })
        await make(1)
        await make(2)
        await BillingEvent.create({ providerEventId: 'evt_other', type: 'payment.succeeded', occurredAt: new Date(), payload: { providerCustomerId: 'cus_someone_else', total: 1 } })

        const { billingEvents } = (await get(`/subscribers/${user.userId}`)).body.data

        expect(billingEvents).toHaveLength(2)
        expect(new Date(billingEvents[0].occurredAt).getTime()).toBeGreaterThan(new Date(billingEvents[1].occurredAt).getTime())
        expect(billingEvents[0].payload).toEqual({ total: 900, currency: 'USD' })
        expect(JSON.stringify(billingEvents)).not.toContain('leak@example.com')
        expect(JSON.stringify(billingEvents)).not.toContain('evt_1')
    })

    it('shows the erasure schedule for a lapsed account when retention is on', async () => {
        process.env.BILLING_RETENTION_ENABLED = 'true'
        const lapsedAt = new Date(Date.now() - 170 * DAY_MS)
        await setSubscription(user.userId, { ...BILLING_STATES.cancelled, lapsedAt, retentionStage: 'reminder', retentionStageAt: new Date(Date.now() - 140 * DAY_MS) })

        const { erasure } = (await get(`/subscribers/${user.userId}`)).body.data
        delete process.env.BILLING_RETENTION_ENABLED

        expect(erasure).toMatchObject({ retentionEnabled: true, lastNoticeStage: 'reminder', held: false })
        expect(new Date(erasure.projectedEraseAt).getTime()).toBeCloseTo(lapsedAt.getTime() + 180 * DAY_MS, -4)
    })

    it('shows no erasure date for an account that is not lapsed', async () => {
        const { erasure } = (await get(`/subscribers/${user.userId}`)).body.data

        expect(erasure.projectedEraseAt).toBeNull()
    })

    it('a subscriber with no subscription row still has a detail view', async () => {
        await Subscription.deleteMany({ userId: user.userId })

        const res = await get(`/subscribers/${user.userId}`)

        expect(res.status).toBe(200)
        expect(res.body.data.subscription).toBeNull()
        expect(res.body.data.readOnly.code).toBe('no_subscription')
    })

    it('records a `subscription.viewed` audit row naming the admin and subject, without the email', async () => {
        await get(`/subscribers/${user.userId}`)

        const row = await AdminAuditLog.findOne({ action: 'subscription.viewed' }).lean()
        expect(row?.adminId?.toString()).toBe(admin.id)
        expect(row?.subjectUserId?.toString()).toBe(user.userId)
        expect(row?.subjectSubscriptionId).toBeTruthy()
        expect(JSON.stringify(row)).not.toContain('jane.doe@example.com')
    })

    it('does not audit a list page or a lookup', async () => {
        await get('/subscribers')
        await get('/subscribers/lookup?q=jane.doe@example.com')

        expect(await AdminAuditLog.countDocuments({ action: 'subscription.viewed' })).toBe(0)
    })

    it('includes the admin history for this subscriber, newest first', async () => {
        await get(`/subscribers/${user.userId}`)
        const { adminHistory } = (await get(`/subscribers/${user.userId}`)).body.data

        expect(adminHistory.length).toBeGreaterThanOrEqual(1)
        expect(adminHistory[0].action).toBe('subscription.viewed')
    })

    it('404s for an unknown user and 400s for a malformed id', async () => {
        expect((await get(`/subscribers/${randomId()}`)).status).toBe(404)
        expect((await get('/subscribers/not-an-id')).status).toBe(400)
    })
})

describe('detail view cap', () => {
    afterEach(() => {
        delete process.env.ADMIN_DETAIL_VIEWS_PER_HOUR
    })

    it('limits how many subscriber details one admin can open per hour, and only that admin', async () => {
        process.env.ADMIN_DETAIL_VIEWS_PER_HOUR = '3'
        const user = await seedSubscriber('jane.doe@example.com')
        const other = await seedAdmin({ role: 'owner' })
        const otherSession = await loginAsAdmin(app, other)

        const statuses: number[] = []
        for (let i = 0; i < 5; i += 1) statuses.push((await get(`/subscribers/${user.userId}`)).status)
        const blocked = await get(`/subscribers/${user.userId}`)
        const otherAdmin = await get(`/subscribers/${user.userId}`, otherSession.token)

        expect(statuses).toEqual([200, 200, 200, 429, 429])
        expect(blocked.body.message).toBe(ERROR_MESSAGES.ADMIN.DETAIL_VIEW_LIMIT)
        expect(otherAdmin.status).toBe(200)
    })

    it('does not count lists and lookups against the cap', async () => {
        process.env.ADMIN_DETAIL_VIEWS_PER_HOUR = '1'
        const user = await seedSubscriber('jane.doe@example.com')

        for (let i = 0; i < 4; i += 1) await get('/subscribers')

        expect((await get(`/subscribers/${user.userId}`)).status).toBe(200)
    })
})
