import { describe, expect, it } from 'vitest'

import { computePayoutVariance, DEFAULT_VARIANCE_TOLERANCE_PERCENT } from '../payoutReconciliation'

describe('computePayoutVariance', () => {
    it('is not flagged when the payout exactly matches local revenue', () => {
        const result = computePayoutVariance(10000, 10000)

        expect(result).toEqual({ varianceMinor: 0, variancePercent: 0, flagged: false })
    })

    it('is not flagged for a payout below local revenue within the normal MoR-fee range', () => {
        // ~6% under - a typical Lemon Squeezy/Polar take, not an anomaly.
        const result = computePayoutVariance(9400, 10000)

        expect(result.varianceMinor).toBe(-600)
        expect(result.variancePercent).toBeCloseTo(-6, 5)
        expect(result.flagged).toBe(false)
    })

    it('flags a payout far below local revenue', () => {
        const result = computePayoutVariance(6000, 10000)

        expect(result.varianceMinor).toBe(-4000)
        expect(result.variancePercent).toBeCloseTo(-40, 5)
        expect(result.flagged).toBe(true)
    })

    it('flags a payout above local revenue', () => {
        const result = computePayoutVariance(15000, 10000)

        expect(result.varianceMinor).toBe(5000)
        expect(result.variancePercent).toBeCloseTo(50, 5)
        expect(result.flagged).toBe(true)
    })

    it('flags right at the boundary only once the tolerance is exceeded', () => {
        const atTolerance = computePayoutVariance(8500, 10000) // exactly -15%
        const overTolerance = computePayoutVariance(8499, 10000)

        expect(atTolerance.flagged).toBe(false)
        expect(overTolerance.flagged).toBe(true)
    })

    it('treats zero payout against zero local revenue as unremarkable', () => {
        const result = computePayoutVariance(0, 0)

        expect(result).toEqual({ varianceMinor: 0, variancePercent: 0, flagged: false })
    })

    it('flags any nonzero payout against zero local revenue', () => {
        const result = computePayoutVariance(500, 0)

        expect(result).toEqual({ varianceMinor: 500, variancePercent: 100, flagged: true })
    })

    it('flags zero payout against nonzero local revenue (a payout that never arrived)', () => {
        const result = computePayoutVariance(0, 10000)

        expect(result.varianceMinor).toBe(-10000)
        expect(result.variancePercent).toBeCloseTo(-100, 5)
        expect(result.flagged).toBe(true)
    })

    it('honours a custom tolerance', () => {
        const strict = computePayoutVariance(9000, 10000, 5)
        const lenient = computePayoutVariance(9000, 10000, 20)

        expect(strict.flagged).toBe(true)
        expect(lenient.flagged).toBe(false)
    })

    it('defaults to a 15% tolerance', () => {
        expect(DEFAULT_VARIANCE_TOLERANCE_PERCENT).toBe(15)
    })
})
