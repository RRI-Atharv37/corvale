import { describe, it, expect } from 'vitest'
import { DISCLAIMERS } from '../disclaimers'

// V2: every predictive / advisory surface named in the pre-v1.0.0 plan has copy, and the debt
// planner - the strongest "reads as financial guidance" case in the app - says so in as many words.

describe('DISCLAIMERS copy', () => {
    it('covers every placement from the V2 + V3 plan', () => {
        expect(Object.keys(DISCLAIMERS).sort()).toEqual(
            [
                'debtPayoff',
                'forecast',
                'pushover',
                'reportsAverages',
                'saver',
                'savingsGoalProjection',
                'subscriptions',
            ].sort()
        )
    })

    it('has non-empty copy for each entry', () => {
        for (const [key, value] of Object.entries(DISCLAIMERS)) {
            expect(value, key).toMatch(/\S/)
        }
    })

    it('states plainly that the debt planner is not financial advice', () => {
        expect(DISCLAIMERS.debtPayoff.toLowerCase()).toContain('not financial advice')
    })

    it('frames forecast and savings projections as estimates, not guarantees', () => {
        expect(DISCLAIMERS.forecast.toLowerCase()).toMatch(/estimate|projected/)
        expect(DISCLAIMERS.savingsGoalProjection.toLowerCase()).toMatch(/estimate|assume/)
    })

    it('tells the user subscriptions are inferred from patterns', () => {
        expect(DISCLAIMERS.subscriptions.toLowerCase()).toContain('inferred')
    })

    it('makes clear the saver and pushover move no real money (V3)', () => {
        expect(DISCLAIMERS.saver.toLowerCase()).toMatch(/moves no money|no transaction/)
        expect(DISCLAIMERS.saver.toLowerCase()).toContain('bank account')
        expect(DISCLAIMERS.pushover.toLowerCase()).toContain('bank account')
        expect(DISCLAIMERS.pushover.toLowerCase()).toMatch(/spendable/)
    })
})
