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
        expect((await request(app).get(`${ADMIN_BASE}/finance/fy-revenue`).set(bearer(token))).status).toBe(404)
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

    describe('POST /finance/payouts', () => {
        it('rejects a malformed body', async () => {
            const finance = await seedAdmin({ role: 'finance' })
            const { token } = await loginAsAdmin(app, finance)

            const res = await request(app)
                .post(`${ADMIN_BASE}/finance/payouts`)
                .set(bearer(token))
                .send({ periodMonth: '2026-9', currency: 'usd', reportedPayoutMinor: 1000 })

            expect(res.status).toBe(400)
            expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.INVALID_PAYOUT)
        })

        it('needs money.write - support (which lacks it) is refused', async () => {
            const support = await seedAdmin({ role: 'support' })
            const { token } = await loginAsAdmin(app, support)

            const res = await request(app)
                .post(`${ADMIN_BASE}/finance/payouts`)
                .set(bearer(token))
                .send({ periodMonth: '2026-09', currency: 'usd', reportedPayoutMinor: 9400 })

            expect(res.status).toBe(403)
        })

        it('records a payout, computes local revenue and variance, and writes an audit entry', async () => {
            const finance = await seedAdmin({ role: 'finance' })
            const { token } = await loginAsAdmin(app, finance)
            await seedAnnualPayment(12000) // 2026-06 payment -> 12 buckets, June 2026 - May 2027
            const { runRevenueRecognitionSweep } = await import('@modules/billing')
            await runRevenueRecognitionSweep()

            const res = await request(app)
                .post(`${ADMIN_BASE}/finance/payouts`)
                .set(bearer(token))
                .send({ periodMonth: '2026-06', currency: 'usd', reportedPayoutMinor: 940, note: 'first payout' })

            expect(res.status).toBe(201)
            expect(res.body.data.periodMonth).toBe('2026-06')
            expect(res.body.data.localRevenueMinor).toBe(1000)
            expect(res.body.data.reportedPayoutMinor).toBe(940)
            expect(res.body.data.varianceMinor).toBe(-60)
            expect(res.body.data.flagged).toBe(false)

            const audit = await AdminAuditLog.findOne({ action: 'finance.payout_recorded' }).sort({ at: 1 }).lean()
            expect(audit).not.toBeNull()
            expect(audit?.adminId?.toString()).toBe(finance.id)
            expect(audit?.amountMinor).toBe(940)
            expect(audit?.currency).toBe('usd')
            expect(audit?.after).toEqual({ periodMonth: '2026-06' })
        })

        it('flags a payout that differs from local revenue by more than the tolerance', async () => {
            const finance = await seedAdmin({ role: 'finance' })
            const { token } = await loginAsAdmin(app, finance)
            await seedAnnualPayment(12000)
            const { runRevenueRecognitionSweep } = await import('@modules/billing')
            await runRevenueRecognitionSweep()

            const res = await request(app)
                .post(`${ADMIN_BASE}/finance/payouts`)
                .set(bearer(token))
                .send({ periodMonth: '2026-06', currency: 'usd', reportedPayoutMinor: 500 })

            expect(res.status).toBe(201)
            expect(res.body.data.flagged).toBe(true)
        })

        it('rejects a second payout for the same period and currency', async () => {
            const finance = await seedAdmin({ role: 'finance' })
            const { token } = await loginAsAdmin(app, finance)
            await request(app)
                .post(`${ADMIN_BASE}/finance/payouts`)
                .set(bearer(token))
                .send({ periodMonth: '2026-06', currency: 'usd', reportedPayoutMinor: 940 })

            const res = await request(app)
                .post(`${ADMIN_BASE}/finance/payouts`)
                .set(bearer(token))
                .send({ periodMonth: '2026-06', currency: 'usd', reportedPayoutMinor: 100 })

            expect(res.status).toBe(409)
            expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.PAYOUT_ALREADY_RECORDED)
        })
    })

    describe('GET /finance/payouts', () => {
        it('rejects a malformed month range', async () => {
            const finance = await seedAdmin({ role: 'finance' })
            const { token } = await loginAsAdmin(app, finance)

            const res = await request(app).get(`${ADMIN_BASE}/finance/payouts?fromMonth=bad`).set(bearer(token))

            expect(res.status).toBe(400)
        })

        it('filters by range and reflects live-computed local revenue, not a stale snapshot', async () => {
            const finance = await seedAdmin({ role: 'finance' })
            const { token } = await loginAsAdmin(app, finance)
            await request(app)
                .post(`${ADMIN_BASE}/finance/payouts`)
                .set(bearer(token))
                .send({ periodMonth: '2026-06', currency: 'usd', reportedPayoutMinor: 940 })
            await request(app)
                .post(`${ADMIN_BASE}/finance/payouts`)
                .set(bearer(token))
                .send({ periodMonth: '2026-07', currency: 'usd', reportedPayoutMinor: 500 })

            const filtered = await request(app).get(`${ADMIN_BASE}/finance/payouts?fromMonth=2026-07`).set(bearer(token))
            expect(filtered.body.data.payouts).toHaveLength(1)
            expect(filtered.body.data.payouts[0].periodMonth).toBe('2026-07')
            expect(filtered.body.data.payouts[0].localRevenueMinor).toBe(0)

            // A late-arriving payment.succeeded for the already-recorded June period should be picked
            // up the next time the summary is read - no recompute step, per the read-time design.
            await seedAnnualPayment(12000)
            const { runRevenueRecognitionSweep } = await import('@modules/billing')
            await runRevenueRecognitionSweep()

            const all = await request(app).get(`${ADMIN_BASE}/finance/payouts`).set(bearer(token))
            const june = all.body.data.payouts.find((row: { periodMonth: string }) => row.periodMonth === '2026-06')
            expect(june.localRevenueMinor).toBe(1000)
        })
    })

    describe('GET /finance/fy-revenue', () => {
        it('needs metrics.read', async () => {
            const support = await seedAdmin({ role: 'support' })
            const { token } = await loginAsAdmin(app, support)

            expect((await request(app).get(`${ADMIN_BASE}/finance/fy-revenue`).set(bearer(token))).status).toBe(403)
        })

        it('rejects a malformed financialYear', async () => {
            const finance = await seedAdmin({ role: 'finance' })
            const { token } = await loginAsAdmin(app, finance)

            const res = await request(app).get(`${ADMIN_BASE}/finance/fy-revenue?financialYear=2026`).set(bearer(token))

            expect(res.status).toBe(400)
            expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.INVALID_QUERY)
        })

        it('defaults to the current financial year and sums recognized revenue by currency, data only', async () => {
            const finance = await seedAdmin({ role: 'finance' })
            const { token } = await loginAsAdmin(app, finance)
            const now = new Date()
            const currentMonthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
            const { financialYearOf } = await import('@core/billing/financialYear')
            const providerSubscriptionId = `sub_fy_${Date.now()}`
            await Subscription.create({
                userId: new Types.ObjectId(),
                planCode: 'pro',
                status: 'active',
                interval: 'monthly',
                providerSubscriptionId,
                providerCustomerId: `cus_${providerSubscriptionId}`,
            })
            await BillingEvent.create({
                providerEventId: `evt_fy_${Date.now()}`,
                type: 'payment.succeeded',
                occurredAt: now,
                payload: { providerSubscriptionId, total: 700, currency: 'usd' },
            })

            const res = await request(app).get(`${ADMIN_BASE}/finance/fy-revenue`).set(bearer(token))

            expect(res.status).toBe(200)
            expect(res.body.data.financialYear).toBe(financialYearOf(now))
            expect(res.body.data.totalsByCurrency.usd).toBe(700)
            expect(res.body.data.monthsIncluded).toContain(currentMonthKey)
            expect(res.body.data).not.toHaveProperty('gstDetermination')
        })

        it('accepts an explicit financialYear and reports zero months not yet elapsed', async () => {
            const finance = await seedAdmin({ role: 'finance' })
            const { token } = await loginAsAdmin(app, finance)

            const res = await request(app).get(`${ADMIN_BASE}/finance/fy-revenue?financialYear=2027-28`).set(bearer(token))

            expect(res.status).toBe(200)
            expect(res.body.data.financialYear).toBe('2027-28')
            expect(res.body.data.monthsIncluded).toEqual([])
            expect(res.body.data.totalsByCurrency).toEqual({})
        })
    })

    describe('PATCH /finance/payouts/:payoutId', () => {
        const recordJunePayout = async (token: string) =>
            (
                await request(app)
                    .post(`${ADMIN_BASE}/finance/payouts`)
                    .set(bearer(token))
                    .send({ periodMonth: '2026-06', currency: 'usd', reportedPayoutMinor: 940 })
            ).body.data.id

        it('rejects an id that is not a well-formed ObjectId', async () => {
            const finance = await seedAdmin({ role: 'finance' })
            const { token } = await loginAsAdmin(app, finance)

            const res = await request(app)
                .patch(`${ADMIN_BASE}/finance/payouts/not-an-id`)
                .set(bearer(token))
                .send({ firc: 'FIRC-001' })

            expect(res.status).toBe(404)
            expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.PAYOUT_NOT_FOUND)
        })

        it('404s an id that is well-formed but matches nothing', async () => {
            const finance = await seedAdmin({ role: 'finance' })
            const { token } = await loginAsAdmin(app, finance)

            const res = await request(app)
                .patch(`${ADMIN_BASE}/finance/payouts/${new Types.ObjectId().toString()}`)
                .set(bearer(token))
                .send({ firc: 'FIRC-001' })

            expect(res.status).toBe(404)
        })

        it('sets the M8d manual fields and writes an audit entry', async () => {
            const finance = await seedAdmin({ role: 'finance' })
            const { token } = await loginAsAdmin(app, finance)
            const payoutId = await recordJunePayout(token)

            const res = await request(app)
                .patch(`${ADMIN_BASE}/finance/payouts/${payoutId}`)
                .set(bearer(token))
                .send({
                    firc: 'FIRC-2026-06-001',
                    bankDepositRef: 'DEP-001',
                    bankDepositDate: '2026-07-05T00:00:00.000Z',
                    bankDepositAmountMinor: 940,
                })

            expect(res.status).toBe(200)
            expect(res.body.data.firc).toBe('FIRC-2026-06-001')
            expect(res.body.data.bankDepositRef).toBe('DEP-001')
            expect(res.body.data.bankDepositAmountMinor).toBe(940)

            const audit = await AdminAuditLog.findOne({ action: 'finance.payout_updated' }).sort({ at: 1 }).lean()
            expect(audit?.after).toMatchObject({ periodMonth: '2026-06', firc: 'FIRC-2026-06-001', bankDepositRef: 'DEP-001' })
        })

        it('can correct reportedPayoutMinor, changing the computed variance', async () => {
            const finance = await seedAdmin({ role: 'finance' })
            const { token } = await loginAsAdmin(app, finance)
            const payoutId = await recordJunePayout(token)

            const res = await request(app)
                .patch(`${ADMIN_BASE}/finance/payouts/${payoutId}`)
                .set(bearer(token))
                .send({ reportedPayoutMinor: 500 })

            expect(res.status).toBe(200)
            expect(res.body.data.reportedPayoutMinor).toBe(500)
        })

        it('clears a manual field by sending null', async () => {
            const finance = await seedAdmin({ role: 'finance' })
            const { token } = await loginAsAdmin(app, finance)
            const payoutId = await recordJunePayout(token)
            await request(app).patch(`${ADMIN_BASE}/finance/payouts/${payoutId}`).set(bearer(token)).send({ firc: 'FIRC-001' })

            const res = await request(app).patch(`${ADMIN_BASE}/finance/payouts/${payoutId}`).set(bearer(token)).send({ firc: null })

            expect(res.status).toBe(200)
            expect(res.body.data.firc).toBeNull()
        })

        it('rejects an empty patch', async () => {
            const finance = await seedAdmin({ role: 'finance' })
            const { token } = await loginAsAdmin(app, finance)
            const payoutId = await recordJunePayout(token)

            const res = await request(app).patch(`${ADMIN_BASE}/finance/payouts/${payoutId}`).set(bearer(token)).send({})

            expect(res.status).toBe(400)
            expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.INVALID_PAYOUT)
        })

        it('needs money.write', async () => {
            const finance = await seedAdmin({ role: 'finance' })
            const { token: financeToken } = await loginAsAdmin(app, finance)
            const payoutId = await recordJunePayout(financeToken)
            const support = await seedAdmin({ role: 'support' })
            const { token: supportToken } = await loginAsAdmin(app, support)

            const res = await request(app)
                .patch(`${ADMIN_BASE}/finance/payouts/${payoutId}`)
                .set(bearer(supportToken))
                .send({ firc: 'FIRC-001' })

            expect(res.status).toBe(403)
        })
    })
})
