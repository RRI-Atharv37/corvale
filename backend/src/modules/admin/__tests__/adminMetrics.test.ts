import request from 'supertest'
import type { Application } from 'express'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { ADMIN_BASE, bearer, buildAdminApp, disableAdmin, loginAsAdmin, seedAdmin } from '@tests/adminHelpers'
import { disableBilling, enableBilling } from '@tests/billingHelpers'
import { MetricDaily } from '@modules/billing'

import { getMetricsOverview } from '../adminMetrics.service'

/**
 * M7b.2 - the read side of the metrics track: `/admin/metrics/overview` only reads what M7b.1's flow
 * counters and M7b.2's stock snapshot have already written to `MetricDaily`. No live `Subscription` read
 * happens here. Access/validation go through the real HTTP route; window aggregation is exercised by
 * calling the service directly with an injected `now`, since the route always uses the real clock.
 */

const NOW = new Date('2026-09-22T12:00:00.000Z')

let app: Application

beforeAll(() => {
    app = buildAdminApp()
})

afterAll(() => {
    disableAdmin()
})

beforeEach(() => {
    enableBilling()
})

afterEach(() => {
    disableBilling()
})

const overview = (token: string, query = '') => request(app).get(`${ADMIN_BASE}/metrics/overview${query}`).set(bearer(token))

describe('access', () => {
    it('is readable by finance and owner, not support, and needs a token', async () => {
        const finance = await seedAdmin({ role: 'finance' })
        const { token: financeToken } = await loginAsAdmin(app, finance)
        const owner = await seedAdmin({ role: 'owner' })
        const { token: ownerToken } = await loginAsAdmin(app, owner)
        const support = await seedAdmin({ role: 'support' })
        const { token: supportToken } = await loginAsAdmin(app, support)

        expect((await overview(financeToken)).status).toBe(200)
        expect((await overview(ownerToken)).status).toBe(200)
        expect((await overview(supportToken)).status).toBe(403)
        expect((await request(app).get(`${ADMIN_BASE}/metrics/overview`)).status).toBe(401)
    })
})

describe('GET /metrics/overview - validation', () => {
    let token: string

    beforeEach(async () => {
        const finance = await seedAdmin({ role: 'finance' })
        ;({ token } = await loginAsAdmin(app, finance))
    })

    it('rejects an out-of-range or non-integer days parameter', async () => {
        for (const query of ['?days=0', '?days=366', '?days=abc']) {
            const res = await overview(token, query)
            expect(res.status, query).toBe(400)
            expect(res.body.message).toBe(ERROR_MESSAGES.ADMIN.INVALID_QUERY)
        }
    })

    it('defaults to a 30-day window', async () => {
        const res = await overview(token)

        expect(res.status).toBe(200)
        expect(res.body.data.windowDays).toBe(30)
    })
})

describe('getMetricsOverview', () => {
    it('sums flow counters across the requested window, in UTC calendar days', async () => {
        await MetricDaily.create({ date: '2026-09-20', flows: { signups: 2, newPaid: 1 } })
        await MetricDaily.create({ date: '2026-09-21', flows: { signups: 3, newPaid: 0 } })
        await MetricDaily.create({ date: '2026-09-01', flows: { signups: 100 } })

        const result = await getMetricsOverview({ days: 3 }, NOW)

        expect(result.windowDays).toBe(3)
        expect(result.flows.signups).toBe(5)
        expect(result.flows.newPaid).toBe(1)
    })

    it('uses the most recent day that carries a stock snapshot, not necessarily the last day of the window', async () => {
        await MetricDaily.create({
            date: '2026-09-19',
            flows: {},
            stock: {
                asOf: new Date('2026-09-19T23:00:00.000Z'),
                segments: [{ planCode: 'pro', status: 'active', interval: 'monthly', grandfatherKind: null, count: 10 }],
                listPriceMrrMinor: 12000,
                atRiskMrrMinor: 0,
            },
        })
        await MetricDaily.create({ date: '2026-09-20', flows: {} })

        const result = await getMetricsOverview({ days: 5 }, NOW)

        expect(result.stock?.listPriceMrrMinor).toBe(12000)
        expect(result.stock?.payingSubscribers).toBe(10)
        expect(result.stock?.arpaMinor).toBe(1200)
        expect(result.dataQuality).toEqual({ daysRequested: 5, daysWithStock: 1 })
    })

    it('reports no stock and null derived rates when nothing has snapshotted yet', async () => {
        const result = await getMetricsOverview({ days: 7 }, NOW)

        expect(result.stock).toBeNull()
        expect(result.rates.logoChurn).toBeNull()
        expect(result.ltv.status).toBe('insufficient_data')
    })

    it('does not sum a day outside the window', async () => {
        await MetricDaily.create({ date: '2026-09-15', flows: { signups: 50 } })
        await MetricDaily.create({ date: '2026-09-21', flows: { signups: 1 } })

        const result = await getMetricsOverview({ days: 3 }, NOW)

        expect(result.flows.signups).toBe(1)
    })

    it('reports movement as null with fewer than two stock-bearing days in the window', async () => {
        await MetricDaily.create({
            date: '2026-09-20',
            flows: {},
            stock: { asOf: new Date('2026-09-20T23:00:00.000Z'), segments: [], listPriceMrrMinor: 5000, atRiskMrrMinor: 0 },
        })

        const result = await getMetricsOverview({ days: 5 }, NOW)

        expect(result.movement).toBeNull()
        expect(result.series).toEqual([{ date: '2026-09-20', mrrMinor: 5000, atRiskMrrMinor: 0 }])
    })

    it('reconciles the flow counters against the stock delta between the earliest and latest snapshot in the window', async () => {
        await MetricDaily.create({
            date: '2026-09-18',
            flows: {},
            stock: { asOf: new Date('2026-09-18T23:00:00.000Z'), segments: [], listPriceMrrMinor: 10000, atRiskMrrMinor: 0 },
        })
        await MetricDaily.create({
            date: '2026-09-20',
            flows: { newMrr: 1500, churnedMrr: 500 },
            stock: { asOf: new Date('2026-09-20T23:00:00.000Z'), segments: [], listPriceMrrMinor: 11000, atRiskMrrMinor: 0 },
        })

        const result = await getMetricsOverview({ days: 5 }, NOW)

        expect(result.movement).toEqual({
            startMrrMinor: 10000,
            endMrrMinor: 11000,
            newMrrMinor: 1500,
            expansionMrrMinor: 0,
            contractionMrrMinor: 0,
            churnedMrrMinor: 500,
            expectedDeltaMinor: 1000,
            actualDeltaMinor: 1000,
            residualMinor: 0,
        })
        expect(result.series.map((point) => point.date)).toEqual(['2026-09-18', '2026-09-20'])
    })
})
