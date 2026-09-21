import { describe, expect, it } from 'vitest'

import {
    DUNNING_STAGES,
    MAX_PAST_DUE_GRACE_DAYS,
    MIN_PAST_DUE_GRACE_DAYS,
    dunningStageIndex,
    dunningStageOffsetsDays,
    resolveDunningStage,
} from '../dunning'

const DAY_MS = 24 * 60 * 60 * 1000
const START = new Date('2026-10-01T00:00:00.000Z')
const after = (days: number) => new Date(START.getTime() + days * DAY_MS)

describe('dunningStageOffsetsDays', () => {
    it('spreads the four stages over a 7-day grace window: 0, 3, 6, 7', () => {
        expect(dunningStageOffsetsDays(7)).toEqual({
            payment_failed: 0,
            reminder: 3,
            final_warning: 6,
            access_paused: 7,
        })
    })

    it('keeps the stages strictly ordered at the shortest allowed grace window', () => {
        const offsets = Object.values(dunningStageOffsetsDays(MIN_PAST_DUE_GRACE_DAYS))

        expect(offsets).toEqual([...offsets].sort((a, b) => a - b))
        expect(new Set(offsets).size).toBe(DUNNING_STAGES.length)
    })

    it('always lands the last stage exactly on the day write access lapses', () => {
        for (const grace of [MIN_PAST_DUE_GRACE_DAYS, 5, 7, 14, MAX_PAST_DUE_GRACE_DAYS]) {
            expect(dunningStageOffsetsDays(grace).access_paused).toBe(grace)
            expect(dunningStageOffsetsDays(grace).final_warning).toBe(grace - 1)
        }
    })
})

describe('resolveDunningStage', () => {
    it('is null before the payment failed', () => {
        expect(resolveDunningStage(START, after(-1), 7)).toBeNull()
    })

    it('is payment_failed from the moment the subscription went past due', () => {
        expect(resolveDunningStage(START, START, 7)).toBe('payment_failed')
        expect(resolveDunningStage(START, after(2.9), 7)).toBe('payment_failed')
    })

    it('escalates on the day boundaries and never goes backwards', () => {
        const seen = [0, 2.9, 3, 5.9, 6, 6.9, 7, 30].map((days) => resolveDunningStage(START, after(days), 7))

        expect(seen).toEqual([
            'payment_failed',
            'payment_failed',
            'reminder',
            'reminder',
            'final_warning',
            'final_warning',
            'access_paused',
            'access_paused',
        ])
    })

    it('reports only the latest due stage when several were missed', () => {
        expect(resolveDunningStage(START, after(6.5), 7)).toBe('final_warning')
    })

    it('follows the grace window it is given', () => {
        expect(resolveDunningStage(START, after(6), 14)).toBe('reminder')
        expect(resolveDunningStage(START, after(14), 14)).toBe('access_paused')
    })
})

describe('dunningStageIndex', () => {
    it('orders the stages, with no stage sorting before the first', () => {
        expect(dunningStageIndex(null)).toBe(-1)
        expect(DUNNING_STAGES.map(dunningStageIndex)).toEqual([0, 1, 2, 3])
    })
})
