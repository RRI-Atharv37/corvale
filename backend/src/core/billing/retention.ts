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

/** The latest stage whose moment has passed; a run after downtime skips the ones it missed. */
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
