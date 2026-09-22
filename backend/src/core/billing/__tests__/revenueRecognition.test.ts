import { describe, expect, it } from 'vitest'

import { addUtcMonths, monthKeyUtc, splitIntoMonthlyBuckets } from '../revenueRecognition'

describe('monthKeyUtc', () => {
    it('formats the UTC calendar month as YYYY-MM', () => {
        expect(monthKeyUtc(new Date('2026-11-15T23:59:59.999Z'))).toBe('2026-11')
        expect(monthKeyUtc(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01')
    })
})

describe('addUtcMonths', () => {
    it('rolls the year over correctly', () => {
        expect(addUtcMonths(new Date('2026-11-15T12:00:00.000Z'), 1).toISOString()).toBe('2026-12-01T00:00:00.000Z')
        expect(addUtcMonths(new Date('2026-11-15T12:00:00.000Z'), 2).toISOString()).toBe('2027-01-01T00:00:00.000Z')
        expect(addUtcMonths(new Date('2026-11-15T12:00:00.000Z'), 11).toISOString()).toBe('2027-10-01T00:00:00.000Z')
    })
})

describe('splitIntoMonthlyBuckets', () => {
    it('returns 12 buckets indexed 1-12', () => {
        const buckets = splitIntoMonthlyBuckets(12000, new Date('2026-01-15T00:00:00.000Z'))

        expect(buckets).toHaveLength(12)
        expect(buckets.map((bucket) => bucket.bucketIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    })

    it('sums back to exactly totalMinor when it divides evenly', () => {
        const buckets = splitIntoMonthlyBuckets(12000, new Date('2026-01-15T00:00:00.000Z'))

        expect(buckets.every((bucket) => bucket.amountMinor === 1000)).toBe(true)
        expect(buckets.reduce((sum, bucket) => sum + bucket.amountMinor, 0)).toBe(12000)
    })

    it('spreads the remainder one minor unit at a time and still sums exactly, with no bucket off by more than one unit from another', () => {
        const buckets = splitIntoMonthlyBuckets(10000, new Date('2026-01-15T00:00:00.000Z'))

        expect(buckets.reduce((sum, bucket) => sum + bucket.amountMinor, 0)).toBe(10000)
        const amounts = buckets.map((bucket) => bucket.amountMinor)
        expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1)
        // 10000 / 12 = 833.33..., remainder 4 - the first 4 buckets get the extra unit.
        expect(amounts.slice(0, 4)).toEqual([834, 834, 834, 834])
        expect(amounts.slice(4)).toEqual(Array(8).fill(833))
    })

    it('starts recognition at the payment\'s UTC calendar month and rolls the year over across the 12 buckets', () => {
        const buckets = splitIntoMonthlyBuckets(1200, new Date('2026-11-20T18:00:00.000Z'))

        expect(buckets[0].recognitionMonth).toBe('2026-11')
        expect(buckets[1].recognitionMonth).toBe('2026-12')
        expect(buckets[2].recognitionMonth).toBe('2027-01')
        expect(buckets[11].recognitionMonth).toBe('2027-10')
    })

    it('handles a total smaller than 12 minor units without a negative or fractional bucket', () => {
        const buckets = splitIntoMonthlyBuckets(5, new Date('2026-01-01T00:00:00.000Z'))

        expect(buckets.reduce((sum, bucket) => sum + bucket.amountMinor, 0)).toBe(5)
        expect(buckets.every((bucket) => Number.isInteger(bucket.amountMinor) && bucket.amountMinor >= 0)).toBe(true)
    })
})
