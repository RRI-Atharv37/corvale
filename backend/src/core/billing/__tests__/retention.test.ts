import { describe, expect, it } from 'vitest'

import {
    DEFAULT_RETENTION_DAYS,
    FINAL_WARNING_LEAD_DAYS,
    MAX_RETENTION_DAYS,
    MIN_RETENTION_DAYS,
    RETENTION_STAGES,
    deriveLapsedAt,
    endedPauseAt,
    isDeletionDue,
    nextRetentionStage,
    projectedDeletionDate,
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

describe('nextRetentionStage - one stage at a time, never skipping a notice', () => {
    const next = (elapsedDays: number, stage: (typeof RETENTION_STAGES)[number] | null, stageAgeDays: number | null = null) =>
        nextRetentionStage({
            lapsedAt: LAPSED,
            now: after(elapsedDays),
            retentionDays: 180,
            stage,
            stageAt: stageAgeDays === null ? null : after(elapsedDays - stageAgeDays),
        })

    it('starts with the notice, even for an account that lapsed long ago', () => {
        expect(next(0, null)).toBe('notice')
        expect(next(175, null)).toBe('notice')
        expect(next(900, null)).toBe('notice')
    })

    it('sends the reminder after the notice, and the final warning only after the reminder', () => {
        expect(next(175, 'notice', 1)).toBe('reminder')
        expect(next(400, 'notice', 1)).toBe('reminder')
    })

    it('waits for each stage to be due', () => {
        expect(next(100, 'notice', 100)).toBeNull()
        expect(next(149.9, null)).toBe('notice')
        expect(next(149.9, 'notice', 149.9)).toBeNull()
        expect(next(150, 'notice', 150)).toBe('reminder')
    })

    it('holds the final warning back until the reminder is at least 23 days old, so it lands 30 days before deletion', () => {
        expect(next(175, 'reminder', 0)).toBeNull()
        expect(next(190, 'reminder', 22.9)).toBeNull()
        expect(next(190, 'reminder', 23)).toBe('final_warning')
        expect(next(173, 'reminder', 23)).toBe('final_warning')
    })

    it('does not send the final warning before its own moment even if the reminder is old', () => {
        expect(next(160, 'reminder', 100)).toBeNull()
    })

    it('never sends the final warning after a reminder with no timestamp', () => {
        expect(next(400, 'reminder', null)).toBeNull()
    })

    it('has nothing more to send after the final warning', () => {
        expect(next(400, 'final_warning', 100)).toBeNull()
    })

    it('is null before the lapse moment', () => {
        expect(nextRetentionStage({ lapsedAt: LAPSED, now: after(-1), retentionDays: 180, stage: null, stageAt: null })).toBeNull()
    })
})

describe('projectedDeletionDate', () => {
    const projected = (elapsedDays: number, sending: (typeof RETENTION_STAGES)[number]) =>
        projectedDeletionDate({ lapsedAt: LAPSED, now: after(elapsedDays), retentionDays: 180, sending })

    it('is the end of the window when every notice goes out on time', () => {
        expect(projected(0, 'notice')).toEqual(after(180))
        expect(projected(150, 'reminder')).toEqual(after(180))
        expect(projected(173, 'final_warning')).toEqual(after(180))
    })

    it('pushes the date back so a late final warning still lands a week before', () => {
        expect(projected(175, 'final_warning')).toEqual(after(182))
    })

    it('pushes the date back so a late reminder still lands 30 days before', () => {
        expect(projected(175, 'reminder')).toEqual(after(205))
    })

    it('accounts for the whole catch-up sequence when the first notice is late', () => {
        expect(projected(175, 'notice')).toEqual(after(205))
        expect(projected(900, 'notice')).toEqual(after(930))
    })

    it('never promises less than the Terms: 30 days after the reminder and 7 after the final warning', () => {
        for (const elapsed of [0, 100, 150, 173, 175, 400]) {
            const reminderAt = Math.max(elapsed, 150)
            const finalAt = Math.max(reminderAt + 23, 173)
            expect(projected(elapsed, 'notice').getTime()).toBeGreaterThanOrEqual(after(reminderAt + 30).getTime())
            expect(projected(elapsed, 'notice').getTime()).toBeGreaterThanOrEqual(after(finalAt + 7).getTime())
        }
    })
})

describe('endedPauseAt', () => {
    it('is now for a pause cut short, and the original end for one that already ran out', () => {
        expect(endedPauseAt(after(50), after(20))).toEqual(after(20))
        expect(endedPauseAt(after(10), after(20))).toEqual(after(10))
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
