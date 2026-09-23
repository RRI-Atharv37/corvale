import { describe, expect, it } from 'vitest'

import { elapsedMonthsInFinancialYear, financialYearOf, isValidFinancialYear, monthsInFinancialYear } from '../financialYear'

describe('isValidFinancialYear', () => {
    it('accepts a well-formed label', () => {
        expect(isValidFinancialYear('2026-27')).toBe(true)
        expect(isValidFinancialYear('1999-00')).toBe(true)
    })

    it('rejects a malformed or internally inconsistent label', () => {
        expect(isValidFinancialYear('2026')).toBe(false)
        expect(isValidFinancialYear('2026-2027')).toBe(false)
        expect(isValidFinancialYear('2026-28')).toBe(false)
        expect(isValidFinancialYear('not-a-year')).toBe(false)
        expect(isValidFinancialYear('')).toBe(false)
    })
})

describe('financialYearOf', () => {
    it('is the same year pair for any month April through December', () => {
        expect(financialYearOf(new Date('2026-04-01T00:00:00.000Z'))).toBe('2026-27')
        expect(financialYearOf(new Date('2026-09-22T00:00:00.000Z'))).toBe('2026-27')
        expect(financialYearOf(new Date('2026-12-31T23:59:59.999Z'))).toBe('2026-27')
    })

    it('rolls back to the prior calendar year for January through March', () => {
        expect(financialYearOf(new Date('2027-01-01T00:00:00.000Z'))).toBe('2026-27')
        expect(financialYearOf(new Date('2027-03-31T23:59:59.999Z'))).toBe('2026-27')
    })
})

describe('monthsInFinancialYear', () => {
    it('returns the 12 UTC months April through March, in order', () => {
        expect(monthsInFinancialYear('2026-27')).toEqual([
            '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
            '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03',
        ])
    })
})

describe('elapsedMonthsInFinancialYear', () => {
    it('excludes months still in the future', () => {
        expect(elapsedMonthsInFinancialYear('2026-27', new Date('2026-09-22T00:00:00.000Z'))).toEqual([
            '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
        ])
    })

    it('includes the whole year once it has closed', () => {
        expect(elapsedMonthsInFinancialYear('2026-27', new Date('2027-06-01T00:00:00.000Z'))).toHaveLength(12)
    })

    it('is empty for a financial year that has not started yet', () => {
        expect(elapsedMonthsInFinancialYear('2027-28', new Date('2026-09-22T00:00:00.000Z'))).toEqual([])
    })
})
