import { describe, expect, it } from 'vitest'

import {
    DEFAULT_RETENTION_DAYS,
    FINAL_WARNING_LEAD_DAYS,
    MAX_RETENTION_DAYS,
    MIN_RETENTION_DAYS,
    RETENTION_STAGES,
    deriveLapsedAt,
    isDeletionDue,
    resolveRetentionStage,
    retentionEndsAt,
    retentionStageIndex,
    retentionStageOffsetsDays,
} from '../retention'

const DAY_MS = 24 * 60 * 60 * 1000
const LAPSED = new Date('2026-10-01T00:00:00.000Z')
const after = (days: number) => new Date(LAPSED.getTime() + days * DAY_MS)

describe('retentionStageOffsetsDays', () => {
    it('spreads the notices over a 180-day window: 0, 150, 173', () => {
        expect(retentionStageOffsetsDays(180)).toEqual({ notice: 0, reminder: 150, final_warning: 173 })
    })

    it('keeps the stages strictly ordered at the shortest allowed window', () => {
        const offsets = Object.values(retentionStageOffsetsDays(MIN_RETENTION_DAYS))

        expect(offsets).toEqual([...offsets].sort((a, b) => a - b))
        expect(new Set(offsets).size).toBe(RETENTION_STAGES.length)
    })

    it('always warns for the last time a fixed number of days before the window ends', () => {
        for (const days of [MIN_RETENTION_DAYS, DEFAULT_RETENTION_DAYS, MAX_RETENTION_DAYS]) {
            expect(days - retentionStageOffsetsDays(days).final_warning).toBe(FINAL_WARNING_LEAD_DAYS)
        }
    })

    it('has a default inside the allowed bounds', () => {
        expect(DEFAULT_RETENTION_DAYS).toBeGreaterThanOrEqual(MIN_RETENTION_DAYS)
        expect(DEFAULT_RETENTION_DAYS).toBeLessThanOrEqual(MAX_RETENTION_DAYS)
    })
})

describe('retentionEndsAt', () => {
    it('is the lapse moment plus the window', () => {
        expect(retentionEndsAt(LAPSED, 180)).toEqual(after(180))
    })
})

describe('retentionStageIndex', () => {
    it('orders no stage before every stage', () => {
        expect(retentionStageIndex(null)).toBe(-1)
        expect(RETENTION_STAGES.map(retentionStageIndex)).toEqual([0, 1, 2])
    })
})

describe('resolveRetentionStage', () => {
    it('is null before the lapse moment', () => {
        expect(resolveRetentionStage(LAPSED, after(-0.001), 180)).toBeNull()
    })

    it.each([
        [0, 'notice'],
        [149.9, 'notice'],
        [150, 'reminder'],
        [172.9, 'reminder'],
        [173, 'final_warning'],
        [400, 'final_warning'],
    ] as const)('day %s is the %s stage', (days, stage) => {
        expect(resolveRetentionStage(LAPSED, after(days), 180)).toBe(stage)
    })
})

describe('isDeletionDue - never without a recorded final warning', () => {
    const due = { lapsedAt: LAPSED, retentionDays: 180, stage: 'final_warning' as const, stageAt: after(173) }

    it('is due once the window has ended and the final warning went out at least a week ago', () => {
        expect(isDeletionDue({ ...due, now: after(180) })).toBe(true)
    })

    it('is not due before the window ends', () => {
        expect(isDeletionDue({ ...due, now: after(179.9) })).toBe(false)
    })

    it.each([null, 'notice', 'reminder'] as const)('is not due when the last recorded stage is %s', (stage) => {
        expect(isDeletionDue({ ...due, stage, now: after(400) })).toBe(false)
    })

    it('is not due when the final warning has no timestamp', () => {
        expect(isDeletionDue({ ...due, stageAt: null, now: after(400) })).toBe(false)
    })

    it('waits the full notice period after a late final warning', () => {
        const late = { ...due, stageAt: after(300) }

        expect(isDeletionDue({ ...late, now: after(306.9) })).toBe(false)
        expect(isDeletionDue({ ...late, now: after(307) })).toBe(true)
    })
})

describe('deriveLapsedAt', () => {
    const now = after(500)

    it('dates an expired trial from the moment the trial ended', () => {
        expect(deriveLapsedAt({ status: 'trial_expired', trialEndsAt: after(30), currentPeriodEnd: null }, now)).toEqual(after(30))
    })

    it('falls back to now for an expired trial with no end date', () => {
        expect(deriveLapsedAt({ status: 'trial_expired', trialEndsAt: null, currentPeriodEnd: null }, now)).toEqual(now)
    })

    it('dates a cancellation from the end of the paid period when that has passed', () => {
        expect(deriveLapsedAt({ status: 'cancelled', trialEndsAt: null, currentPeriodEnd: after(60) }, now)).toEqual(after(60))
    })

    it.each([null, after(900)])('uses now for a cancellation whose period end is %s', (currentPeriodEnd) => {
        expect(deriveLapsedAt({ status: 'cancelled', trialEndsAt: null, currentPeriodEnd }, now)).toEqual(now)
    })
})
