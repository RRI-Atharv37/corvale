import request from 'supertest'
import type { Application } from 'express'
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { ADMIN_BASE, bearer, buildAdminApp, disableAdmin, loginAsAdmin, seedAdmin } from '@tests/adminHelpers'
import { AdminAuditLog } from '@modules/admin'
import { BillingEvent, DeferredRevenueEntry, Subscription } from '@modules/billing'

/**
 * M8e - the admin-facing deferred-revenue surface. Mounted only while `FINANCE_OPS_ENABLED` is
 * true, same conditional-mount discipline `admin.routes.ts` already uses for everything else;
 * `DeferredRevenueEntry` carries no `userId`/PII so these tests seed `BillingEvent`/`Subscription`
 * directly rather than posting a webhook.
 */

let eventCounter = 0
const seedAnnualPayment = async (total = 12000) => {
    eventCounter += 1
    const providerSubscriptionId = `sub_fin_${eventCounter}`
    await Subscription.create({
        userId: new Types.ObjectId(),
        planCode: 'pro',
        status: 'active',
        interval: 'annual',
        providerSubscriptionId,
        providerCustomerId: `cus_${providerSubscriptionId}`,
    })
    await BillingEvent.create({
        providerEventId: `evt_fin_${eventCounter}`,
        type: 'payment.succeeded',
        occurredAt: new Date('2026-06-10T00:00:00.000Z'),
        payload: { providerSubscriptionId, total, currency: 'usd' },
    })
    return providerSubscriptionId
}

afterEach(() => {
    disableAdmin()
    // Not in adminHelpers' ADMIN_ENV_KEYS (it's a billing-module flag, not an admin one) - clear it
    // explicitly so it cannot leak into a sibling test file sharing this worker's process.env.
    delete process.env.FINANCE_OPS_ENABLED
})

describe('conditional mount', () => {
    it('is a 404 while FINANCE_OPS_ENABLED is not true, even with ADMIN_ENABLED on', async () => {
        const app = buildAdminApp()
        const finance = await seedAdmin({ role: 'finance' })
        const { token } = await loginAsAdmin(app, finance)

        expect((await request(app).get(`${ADMIN_BASE}/finance/recognition/summary`).set(bearer(token))).status).toBe(404)
        expect((await request(app).get(`${ADMIN_BASE}/finance/recognition/export.csv`).set(bearer(token))).status).toBe(404)
        expect((await request(app).post(`${ADMIN_BASE}/finance/recognition/run`).set(bearer(token)).send({})).status).toBe(404)
    })
})

describe('with FINANCE_OPS_ENABLED', () => {
    let app: Application

    beforeEach(() => {
        app = buildAdminApp({ FINANCE_OPS_ENABLED: 'true' })
    })

    describe('access', () => {
        it('summary/export are readable by finance and owner, not support; run needs money.write', async () => {
            const finance = await seedAdmin({ role: 'finance' })
            const { token: financeToken } = await loginAsAdmin(app, finance)
            const owner = await seedAdmin({ role: 'owner' })
            const { token: ownerToken } = await loginAsAdmin(app, owner)
            const support = await seedAdmin({ role: 'support' })
            const { token: supportToken } = await loginAsAdmin(app, support)

            expect((await request(app).get(`${ADMIN_BASE}/finance/recognition/summary`).set(bearer(financeToken))).status).toBe(200)
            expect((await request(app).get(`${ADMIN_BASE}/finance/recognition/summary`).set(bearer(ownerToken))).status).toBe(200)
            expect((await request(app).get(`${ADMIN_BASE}/finance/recognition/summary`).set(bearer(supportToken))).status).toBe(403)
            expect((await request(app).post(`${ADMIN_BASE}/finance/recognition/run`).set(bearer(supportToken)).send({})).status).toBe(403)
            expect((await request(app).get(`${ADMIN_BASE}/finance/recognition/summary`)).status).toBe(401)
        })
    })

    describe('GET /finance/recognition/summary', () => {
        it('rejects a malformed month', async () => {
            const finance = await seedAdmin({ role: 'finance' })
            const { token } = await loginAsAdmin(app, finance)

            const res = await request(app).get(`${ADMIN_BASE}/finance/recognition/summary?fromMonth=2026-13`).set(bearer(token))

            expect(res.status).toBe(400)
            expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.INVALID_QUERY)
        })

        it('returns months aggregated from DeferredRevenueEntry, filtered by range', async () => {
            const finance = await seedAdmin({ role: 'finance' })
            const { token } = await loginAsAdmin(app, finance)
            await seedAnnualPayment(12000)
            const { runRevenueRecognitionSweep } = await import('@modules/billing')
            await runRevenueRecognitionSweep()

            const res = await request(app).get(`${ADMIN_BASE}/finance/recognition/summary`).set(bearer(token))

            expect(res.status).toBe(200)
            expect(res.body.data.months).toHaveLength(12)
            expect(res.body.data.months.reduce((sum: number, month: { recognizedAmountMinor: number }) => sum + month.recognizedAmountMinor, 0)).toBe(12000)
        })
    })

    describe('GET /finance/recognition/export.csv', () => {
        it('streams a CSV with no provider/subscription ids in it', async () => {
            const finance = await seedAdmin({ role: 'finance' })
            const { token } = await loginAsAdmin(app, finance)
            const providerSubscriptionId = await seedAnnualPayment(12000)
            const { runRevenueRecognitionSweep } = await import('@modules/billing')
            await runRevenueRecognitionSweep()

            const res = await request(app).get(`${ADMIN_BASE}/finance/recognition/export.csv`).set(bearer(token))

            expect(res.status).toBe(200)
            expect(res.headers['content-type']).toContain('text/csv')
            expect(res.text.split('\n')[0]).toBe('recognitionMonth,planCode,bucketIndex,recognizedAmountMinor,currency,paymentOccurredAt')
            expect(res.text).not.toContain(providerSubscriptionId)
            expect(res.text).not.toContain('sourceEventId')
            expect(res.text.trim().split('\n')).toHaveLength(13) // header + 12 buckets
        })
    })

    describe('POST /finance/recognition/run', () => {
        it('runs the sweep on demand, is idempotent, and writes an audit entry', async () => {
            const owner = await seedAdmin({ role: 'owner' })
            const { token } = await loginAsAdmin(app, owner)
            await seedAnnualPayment(12000)

            const first = await request(app).post(`${ADMIN_BASE}/finance/recognition/run`).set(bearer(token)).send({})
            expect(first.status).toBe(200)
            expect(first.body.data.entriesCreated).toBe(12)
            expect(await DeferredRevenueEntry.countDocuments({})).toBe(12)

            const second = await request(app).post(`${ADMIN_BASE}/finance/recognition/run`).set(bearer(token)).send({})
            expect(second.body.data.entriesCreated).toBe(0)
            expect(await DeferredRevenueEntry.countDocuments({})).toBe(12)

            const audit = await AdminAuditLog.findOne({ action: 'finance.recognition_run' }).sort({ at: 1 }).lean()
            expect(audit).not.toBeNull()
            expect(audit?.adminId?.toString()).toBe(owner.id)
            expect(audit?.after).toEqual({ affectedCount: 12 })
        })
    })
})
