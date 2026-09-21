import request from 'supertest'
import type { Application } from 'express'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import defaultApp from '@http/app'
import { registerUser } from '@tests/helpers'
import {
    BILLING_STATES,
    DAY_MS,
    daysFromNow,
    disableBilling,
    enableBilling,
    seedTestPlans,
    setSubscription,
} from '@tests/billingHelpers'
import { ADMIN_BASE, bearer, buildAdminApp, disableAdmin, loginAsAdmin, seedAdmin } from '@tests/adminHelpers'
import { BillingEvent, JobRun, Subscription } from '@modules/billing'

/**
 * M7.2 - operational health: what needs an operator's attention today. Aggregate and id-only; nothing
 * here names a person.
 */

let app: Application
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
    const admin = await seedAdmin({ role: 'support' })
    ;({ token } = await loginAsAdmin(app, admin))
})

afterEach(() => {
    disableBilling()
    delete process.env.BILLING_RETENTION_ENABLED
})

const health = async () => (await request(app).get(`${ADMIN_BASE}/ops/health`).set(bearer(token))).body.data

describe('GET /ops/health', () => {
    it('is readable by every role and needs a token', async () => {
        expect((await request(app).get(`${ADMIN_BASE}/ops/health`)).status).toBe(401)
        for (const role of ['finance', 'owner'] as const) {
            const other = await seedAdmin({ role })
            const session = await loginAsAdmin(app, other)

            expect((await request(app).get(`${ADMIN_BASE}/ops/health`).set(bearer(session.token))).status).toBe(200)
        }
    })

    it('reports the switches that decide what the sweeps do', async () => {
        process.env.BILLING_RETENTION_ENABLED = 'true'

        const data = await health()

        expect(data).toMatchObject({ billingEnabled: true, retentionEnabled: true })
        disableBilling()
        expect(await health()).toMatchObject({ billingEnabled: false })
    })

    it('counts webhook events that failed and were never applied, without their payloads', async () => {
        await BillingEvent.create({ providerEventId: 'evt_bad', type: 'payment.succeeded', occurredAt: new Date(), payload: { providerCustomerId: 'cus_x', total: 5 }, processedAt: null, error: 'boom' })
        await BillingEvent.create({ providerEventId: 'evt_ok', type: 'payment.succeeded', occurredAt: new Date(), payload: {}, processedAt: new Date(), error: null })
        await BillingEvent.create({ providerEventId: 'evt_inflight', type: 'payment.succeeded', occurredAt: new Date(), payload: {}, processedAt: null, error: null })

        const { unprocessedEvents } = await health()

        expect(unprocessedEvents.count).toBe(1)
        expect(unprocessedEvents.recent).toEqual([expect.objectContaining({ type: 'payment.succeeded', error: 'boom' })])
        const raw = JSON.stringify(unprocessedEvents)
        expect(raw).not.toContain('cus_x')
        expect(raw).not.toContain('evt_bad')
    })

    it('lists past-due subscribers whose grace window closes within two days', async () => {
        const closing = await registerUser(defaultApp, { email: 'closing@example.com' })
        const safe = await registerUser(defaultApp, { email: 'safe@example.com' })
        await setSubscription(closing.userId, { status: 'past_due', pastDueSince: new Date(Date.now() - 6 * DAY_MS) })
        await setSubscription(safe.userId, { status: 'past_due', pastDueSince: new Date(Date.now() - 1 * DAY_MS) })

        const { pastDueNearGraceEnd } = await health()

        expect(pastDueNearGraceEnd.count).toBe(1)
        expect(pastDueNearGraceEnd.items).toEqual([expect.objectContaining({ userId: closing.userId })])
        expect(Object.keys(pastDueNearGraceEnd.items[0]).sort()).toEqual(['graceEndsAt', 'userId'])
    })

    it('lists accounts due to be erased in the next 14 days, only when retention is enabled', async () => {
        const soon = await registerUser(defaultApp, { email: 'soon@example.com' })
        const later = await registerUser(defaultApp, { email: 'later@example.com' })
        await setSubscription(soon.userId, { ...BILLING_STATES.cancelled, lapsedAt: new Date(Date.now() - 170 * DAY_MS), retentionStage: 'reminder', retentionStageAt: new Date() })
        await setSubscription(later.userId, { ...BILLING_STATES.cancelled, lapsedAt: new Date(Date.now() - 100 * DAY_MS), retentionStage: 'notice', retentionStageAt: new Date() })

        expect((await health()).upcomingErasures).toMatchObject({ retentionEnabled: false, count: 0, items: [] })

        process.env.BILLING_RETENTION_ENABLED = 'true'
        const { upcomingErasures } = await health()

        expect(upcomingErasures.days).toBe(14)
        expect(upcomingErasures.count).toBe(1)
        expect(upcomingErasures.items).toEqual([expect.objectContaining({ userId: soon.userId })])
        expect(Object.keys(upcomingErasures.items[0]).sort()).toEqual(['eraseOn', 'userId'])
    })

    it('leaves a free-forever account and a held account out of the erasure list', async () => {
        process.env.BILLING_RETENTION_ENABLED = 'true'
        const forever = await registerUser(defaultApp, { email: 'forever@example.com' })
        const held = await registerUser(defaultApp, { email: 'held@example.com' })
        const lapsed = { ...BILLING_STATES.cancelled, lapsedAt: new Date(Date.now() - 170 * DAY_MS) }
        await setSubscription(forever.userId, { ...lapsed, grandfatherKind: 'free_forever' })
        await setSubscription(held.userId, lapsed)
        await Subscription.updateOne({ userId: held.userId }, { $set: { retentionHoldUntil: daysFromNow(60) } })

        expect((await health()).upcomingErasures.count).toBe(0)
    })

    it('shows the last sweep and reconcile, and flags a sweep that has gone quiet', async () => {
        const never = await health()
        expect(never.jobs['sweep:billing']).toEqual({ lastRun: null, stale: true })
        expect(never.jobs['reconcile:billing']).toEqual({ lastRun: null, stale: true })

        await JobRun.create({ name: 'sweep:billing', startedAt: new Date(Date.now() - 60_000), finishedAt: new Date(Date.now() - 50_000), ok: true, exitCode: 0, counts: { trialsExpired: 2 } })
        await JobRun.create({ name: 'reconcile:billing', startedAt: new Date(Date.now() - 5 * 60 * 60 * 1000), finishedAt: new Date(Date.now() - 5 * 60 * 60 * 1000 + 1000), ok: false, exitCode: 1, counts: {} })

        const { jobs } = await health()

        expect(jobs['sweep:billing'].stale).toBe(false)
        expect(jobs['sweep:billing'].lastRun).toMatchObject({ ok: true, counts: { trialsExpired: 2 } })
        expect(jobs['reconcile:billing'].lastRun.ok).toBe(false)
    })

    it('treats a sweep older than two hours as stale', async () => {
        await JobRun.create({ name: 'sweep:billing', startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000), finishedAt: new Date(Date.now() - 3 * 60 * 60 * 1000 + 500), ok: true, exitCode: 0, counts: {} })

        expect((await health()).jobs['sweep:billing'].stale).toBe(true)
    })
})
