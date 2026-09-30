import type { SubscriptionStatus } from './constants'

export const RETENTION_STAGES = ['notice', 'reminder', 'final_warning'] as const
export type RetentionStage = (typeof RETENTION_STAGES)[number]

export const LAPSED_STATUSES = ['trial_expired', 'cancelled'] as const satisfies readonly SubscriptionStatus[]

export const DEFAULT_RETENTION_DAYS = 180
export const MIN_RETENTION_DAYS = 60
export const MAX_RETENTION_DAYS = 3650

export const REMINDER_LEAD_DAYS = 30
export const FINAL_WARNING_LEAD_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

export const retentionStageOffsetsDays = (retentionDays: number): Record<RetentionStage, number> => ({
    notice: 0,
    reminder: retentionDays - REMINDER_LEAD_DAYS,
    final_warning: retentionDays - FINAL_WARNING_LEAD_DAYS,
})

export const retentionStageIndex = (stage: RetentionStage | null): number =>
    stage === null ? -1 : RETENTION_STAGES.indexOf(stage)

export const retentionEndsAt = (lapsedAt: Date, retentionDays: number): Date =>
    new Date(lapsedAt.getTime() + retentionDays * DAY_MS)

/** The latest stage whose moment has passed. Not what gets sent after downtime: that is `nextRetentionStage`. */
export const resolveRetentionStage = (lapsedAt: Date, now: Date, retentionDays: number): RetentionStage | null => {
    const elapsedMs = now.getTime() - lapsedAt.getTime()
    if (elapsedMs < 0) return null

    const offsets = retentionStageOffsetsDays(retentionDays)
    let due: RetentionStage | null = null
    for (const stage of RETENTION_STAGES) {
        if (elapsedMs >= offsets[stage] * DAY_MS) due = stage
    }
    return due
}

/** The final warning waits until the reminder is this old, so the reminder still lands `REMINDER_LEAD_DAYS` before deletion. */
export const REMINDER_TO_FINAL_WARNING_DAYS = REMINDER_LEAD_DAYS - FINAL_WARNING_LEAD_DAYS

interface NextStageInput {
    lapsedAt: Date
    now: Date
    retentionDays: number
    stage: RetentionStage | null
    stageAt: Date | null
}

/**
 * The next notice to send: the stage after the last recorded one, once its moment has come. A run after
 * downtime, or the first run after retention is switched on, walks the stages one at a time instead of
 * jumping to the latest, so the notice, the reminder and the final warning are always all delivered.
 */
export const nextRetentionStage = ({ lapsedAt, now, retentionDays, stage, stageAt }: NextStageInput): RetentionStage | null => {
    const due = resolveRetentionStage(lapsedAt, now, retentionDays)
    const next = RETENTION_STAGES[retentionStageIndex(stage) + 1]
    if (due === null || next === undefined || retentionStageIndex(next) > retentionStageIndex(due)) return null

    if (next === 'final_warning') {
        if (stageAt === null || now.getTime() - stageAt.getTime() < REMINDER_TO_FINAL_WARNING_DAYS * DAY_MS) return null
    }
    return next
}

interface ProjectedDeletionInput {
    lapsedAt: Date
    now: Date
    retentionDays: number
    sending: RetentionStage
}

/** The earliest erasure date that keeps every promised lead time, given the stage going out now and the stages still to follow. */
export const projectedDeletionDate = ({ lapsedAt, now, retentionDays, sending }: ProjectedDeletionInput): Date => {
    const offsets = retentionStageOffsetsDays(retentionDays)
    const atOffset = (stage: RetentionStage): number => lapsedAt.getTime() + offsets[stage] * DAY_MS

    const reminderAt = sending === 'notice' ? Math.max(now.getTime(), atOffset('reminder')) : now.getTime()
    const finalWarningAt =
        sending === 'final_warning'
            ? now.getTime()
            : Math.max(now.getTime(), atOffset('final_warning'), reminderAt + REMINDER_TO_FINAL_WARNING_DAYS * DAY_MS)

    return new Date(Math.max(retentionEndsAt(lapsedAt, retentionDays).getTime(), finalWarningAt + FINAL_WARNING_LEAD_DAYS * DAY_MS))
}

interface DeletionDueInput {
    lapsedAt: Date
    now: Date
    retentionDays: number
    stage: RetentionStage | null
    stageAt: Date | null
}

/**
 * Deletion needs the window to have ended AND a final warning that was recorded (so actually sent)
 * at least `FINAL_WARNING_LEAD_DAYS` ago; a warning sent late after downtime therefore pushes the
 * deletion back rather than skipping the notice.
 */
export const isDeletionDue = ({ lapsedAt, now, retentionDays, stage, stageAt }: DeletionDueInput): boolean => {
    if (stage !== 'final_warning' || stageAt === null) return false
    if (now.getTime() < retentionEndsAt(lapsedAt, retentionDays).getTime()) return false
    return now.getTime() - stageAt.getTime() >= FINAL_WARNING_LEAD_DAYS * DAY_MS
}

interface LapsedSubscription {
    status: SubscriptionStatus
    trialEndsAt: Date | null
    currentPeriodEnd: Date | null
}

/** Best knowledge of when a lapsed row stopped being writable, for rows that were never stamped. */
export const deriveLapsedAt = (subscription: LapsedSubscription, now: Date): Date => {
    if (subscription.status === 'trial_expired') return subscription.trialEndsAt ?? now

    const periodEnd = subscription.currentPeriodEnd
    return periodEnd !== null && periodEnd.getTime() <= now.getTime() ? periodEnd : now
}

/**
 * An admin comp or erasure hold pauses the retention clock, and when it ends the window restarts from that
 * moment: a person who was comped for 90 days gets a full notice cycle, not a same-day final warning.
 */
export const retentionClockStart = (
    lapsedAt: Date,
    retentionHoldUntil: Date | null | undefined,
    compUntil: Date | null | undefined
): Date => {
    let start = lapsedAt
    for (const pauseEnd of [retentionHoldUntil, compUntil]) {
        if (pauseEnd && pauseEnd.getTime() > start.getTime()) start = pauseEnd
    }
    return start
}

/** When a comp or hold stopped pausing the clock: its own end if that has passed, otherwise now (an admin cut it short). */
export const endedPauseAt = (pauseUntil: Date, now: Date): Date => (pauseUntil.getTime() < now.getTime() ? pauseUntil : now)

export const isRetentionPaused = (
    retentionHoldUntil: Date | null | undefined,
    compUntil: Date | null | undefined,
    now: Date
): boolean => [retentionHoldUntil, compUntil].some((pauseEnd) => !!pauseEnd && pauseEnd.getTime() > now.getTime())
