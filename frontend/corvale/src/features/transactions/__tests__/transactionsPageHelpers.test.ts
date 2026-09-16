import { describe, expect, it } from 'vitest'
import { amountPrefix } from '../transactionsPageHelpers'

describe('transactionsPageHelpers: amountPrefix', () => {
    it('returns + for income and − for expense', () => {
        expect(amountPrefix('income')).toBe('+')
        expect(amountPrefix('expense')).toBe('−')
    })

    it('signs a transfer leg by its resolved direction (BUG-35)', () => {
        expect(amountPrefix('transfer', 'in')).toBe('+')
        expect(amountPrefix('transfer', 'out')).toBe('−')
    })

    it('falls back to no sign when a transfer leg has no resolvable direction', () => {
        expect(amountPrefix('transfer')).toBe('')
        expect(amountPrefix('transfer', undefined)).toBe('')
    })
})
