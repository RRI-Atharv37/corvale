import { describe, expect, it } from 'vitest'

import {
    LIFECYCLE_EMAIL_STAGES,
    WIN_BACK_DELAY_DAYS,
    lifecycleStageIndex,
    resolveWinBackDue,
    resolveTrialLifecycleStage,
} from '../lifecycleEmail'

const DAY_MS = 24 * 60 * 60 * 1000
const START = new Date('2026-10-01T12:00:00.000Z')
const at = (days: number) => new Date(START.getTime() + days * DAY_MS)
const TRIAL_END = at(30)

describe('resolveTrialLifecycleStage', () => {
    it('is the welcome stage from the moment the trial starts', () => {
        expect(resolveTrialLifecycleStage(START, TRIAL_END, at(0))).toBe('trial_welcome')
        expect(resolveTrialLifecycleStage(START, TRIAL_END, at(6.9))).toBe('trial_welcome')
    })

    it('steps through day 7, day 21 and the two-days-left stage', () => {
        expect(resolveTrialLifecycleStage(START, TRIAL_END, at(7))).toBe('trial_day_7')
        expect(resolveTrialLifecycleStage(START, TRIAL_END, at(20.9))).toBe('trial_day_7')
        expect(resolveTrialLifecycleStage(START, TRIAL_END, at(21))).toBe('trial_day_21')
        expect(resolveTrialLifecycleStage(START, TRIAL_END, at(27.9))).toBe('trial_day_21')
        expect(resolveTrialLifecycleStage(START, TRIAL_END, at(28))).toBe('trial_ending')
    })

    it('is the expiry stage at and after the end of the trial', () => {
        expect(resolveTrialLifecycleStage(START, TRIAL_END, at(29.99))).toBe('trial_ending')
        expect(resolveTrialLifecycleStage(START, TRIAL_END, at(30))).toBe('trial_expired')
        expect(resolveTrialLifecycleStage(START, TRIAL_END, at(90))).toBe('trial_expired')
    })

    it('after downtime resolves only the latest due stage, never the ones it missed', () => {
        expect(resolveTrialLifecycleStage(START, TRIAL_END, at(25))).toBe('trial_day_21')
    })

    it('measures the ending stage from the real end date, so an extended trial is not told it ends early', () => {
        const extendedEnd = at(60)
        expect(resolveTrialLifecycleStage(START, extendedEnd, at(28))).toBe('trial_day_21')
        expect(resolveTrialLifecycleStage(START, extendedEnd, at(58))).toBe('trial_ending')
    })

    it('is null before the trial start', () => {
        expect(resolveTrialLifecycleStage(START, TRIAL_END, at(-1))).toBeNull()
    })
})

describe('resolveWinBackDue', () => {
    it(`is due ${WIN_BACK_DELAY_DAYS} days after the account lapsed, not before`, () => {
        const lapsedAt = at(0)
        expect(resolveWinBackDue(lapsedAt, at(WIN_BACK_DELAY_DAYS - 0.1))).toBe(false)
        expect(resolveWinBackDue(lapsedAt, at(WIN_BACK_DELAY_DAYS))).toBe(true)
    })
})

describe('lifecycleStageIndex', () => {
    it('orders the stages so a later stage is always greater, with win-back last', () => {
        expect(lifecycleStageIndex(null)).toBe(-1)
        const indexes = LIFECYCLE_EMAIL_STAGES.map(lifecycleStageIndex)
        expect(indexes).toEqual([...indexes].sort((a, b) => a - b))
        expect(LIFECYCLE_EMAIL_STAGES[LIFECYCLE_EMAIL_STAGES.length - 1]).toBe('win_back')
    })
})
