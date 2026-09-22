import { describe, expect, it } from 'vitest'

import {
    calculateArpa,
    calculateDunningRecoveryRate,
    calculateEstimatedLtv,
    calculateLogoChurn,
    calculateMrr,
    calculateRevenueChurn,
    calculateTrialConversionRate,
    dateKeyUtc,
    LTV_CAP_MONTHS,
    planMrrMinor,
    ZERO_FLOWS,
    type MetricStockSegment,
} from '../metrics'

/** M7b.1 - pure metrics math, parity-tested the way `shared/` is: no DB, no clock, every input explicit. */

describe('dateKeyUtc', () => {
    it('formats as a UTC calendar day regardless of local offset', () => {
        expect(dateKeyUtc(new Date('2026-09-22T23:59:59.999Z'))).toBe('2026-09-22')
        expect(dateKeyUtc(new Date('2026-09-22T00:00:00.000Z'))).toBe('2026-09-22')
    })
})

describe('ZERO_FLOWS', () => {
    it('is every flow field at zero', () => {
        expect(Object.values(ZERO_FLOWS).every((value) => value === 0)).toBe(true)
        expect(ZERO_FLOWS.signups).toBe(0)
    })
})

describe('planMrrMinor', () => {
    it('uses the monthly price for a monthly or unset interval', () => {
        expect(planMrrMinor({ monthly: 1200, annual: 9600 }, 'monthly')).toBe(1200)
        expect(planMrrMinor({ monthly: 1200, annual: 9600 }, null)).toBe(1200)
    })

    it('divides the annual price by 12, monthly-equivalent, never at face value', () => {
        expect(planMrrMinor({ monthly: 1200, annual: 9600 }, 'annual')).toBe(800)
    })

    it('is 0 when the relevant price is not set', () => {
        expect(planMrrMinor({ monthly: null, annual: 9600 }, 'monthly')).toBe(0)
        expect(planMrrMinor({ monthly: 1200, annual: null }, 'annual')).toBe(0)
    })
})

describe('calculateMrr', () => {
    const prices = { plus: { monthly: 600, annual: 6000 }, pro: { monthly: 1200, annual: 9600 } }

    const segment = (over: Partial<MetricStockSegment>): MetricStockSegment => ({
        planCode: 'pro',
        status: 'active',
        interval: 'monthly',
        grandfatherKind: null,
        count: 1,
        ...over,
    })

    it('sums list-price MRR across active and past_due segments only', () => {
        const result = calculateMrr(
            [segment({ status: 'active', count: 2 }), segment({ status: 'past_due', count: 1 }), segment({ status: 'trialing', count: 5 })],
            prices
        )

        expect(result.listPriceMrrMinor).toBe(1200 * 2 + 1200 * 1)
    })

    it('reports past_due MRR separately as at-risk, still included in the total', () => {
        const result = calculateMrr([segment({ status: 'active', count: 1 }), segment({ status: 'past_due', count: 1 })], prices)

        expect(result.atRiskMrrMinor).toBe(1200)
        expect(result.listPriceMrrMinor).toBe(2400)
    })

    it('excludes free_forever - never bought, never counted', () => {
        const result = calculateMrr([segment({ status: 'active', grandfatherKind: 'free_forever', count: 10 })], prices)

        expect(result.listPriceMrrMinor).toBe(0)
    })

    it('converts an annual segment to its monthly equivalent', () => {
        const result = calculateMrr([segment({ status: 'active', interval: 'annual', count: 1 })], prices)

        expect(result.listPriceMrrMinor).toBe(800)
    })

    it('skips a plan code with no price entry rather than throwing', () => {
        const result = calculateMrr([segment({ planCode: 'plus', status: 'active', count: 1 })], {})

        expect(result.listPriceMrrMinor).toBe(0)
    })
})

describe('calculateArpa / calculateLogoChurn / calculateRevenueChurn / conversion / recovery', () => {
    it('is null on a zero denominator rather than dividing by zero', () => {
        expect(calculateArpa(1000, 0)).toBeNull()
        expect(calculateLogoChurn(3, 0)).toBeNull()
        expect(calculateRevenueChurn(100, 0, 0)).toBeNull()
        expect(calculateTrialConversionRate(0, 0)).toBeNull()
        expect(calculateDunningRecoveryRate(5, 0)).toBeNull()
    })

    it('computes the ordinary ratios', () => {
        expect(calculateArpa(120000, 100)).toBe(1200)
        expect(calculateLogoChurn(5, 100)).toBe(0.05)
        expect(calculateRevenueChurn(200, 100, 3000)).toBeCloseTo(0.1)
        expect(calculateTrialConversionRate(30, 70)).toBe(0.3)
        expect(calculateDunningRecoveryRate(8, 10)).toBe(0.8)
    })
})

describe('calculateEstimatedLtv', () => {
    const base = { arpaNetMinor: 1000, churnEvents: 40, subscribersAtRisk: 400, windowDays: 90 }

    it('reports insufficient_data below the window or churn-event floor', () => {
        expect(calculateEstimatedLtv({ ...base, windowDays: 89 }).status).toBe('insufficient_data')
        expect(calculateEstimatedLtv({ ...base, churnEvents: 29 }).status).toBe('insufficient_data')
        expect(calculateEstimatedLtv({ ...base, subscribersAtRisk: 0 }).status).toBe('insufficient_data')
        expect(calculateEstimatedLtv({ ...base, windowDays: 89 }).ltvMinor).toBeNull()
    })

    it('caps at 36 months and tags it, never showing an exploding or infinite figure', () => {
        const result = calculateEstimatedLtv({ ...base, churnEvents: 40, subscribersAtRisk: 4000 })

        expect(result.status).toBe('capped')
        expect(result.ltvMinor).toBe(1000 * LTV_CAP_MONTHS)
        expect(result.lowMinor).toBeNull()
        expect(result.highMinor).toBeNull()
    })

    it('computes 1/c months, capped, with a low/high band when churn is in the ordinary range', () => {
        const result = calculateEstimatedLtv(base)

        expect(result.status).toBe('ok')
        expect(result.churnRate).toBeCloseTo(0.1)
        expect(result.ltvMinor).toBe(Math.round(1000 * 10))
        expect(result.lowMinor).not.toBeNull()
        expect(result.highMinor).not.toBeNull()
        expect(result.lowMinor as number).toBeLessThan(result.ltvMinor as number)
        expect(result.highMinor as number).toBeGreaterThan(result.ltvMinor as number)
    })

    it('never returns a low/high band wider than the 36-month cap', () => {
        const result = calculateEstimatedLtv({ ...base, churnEvents: 30, subscribersAtRisk: 300 })

        expect(result.highMinor as number).toBeLessThanOrEqual(1000 * LTV_CAP_MONTHS)
    })
})
