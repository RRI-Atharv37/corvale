export const DUNNING_STAGES = ['payment_failed', 'reminder', 'final_warning', 'access_paused'] as const
export type DunningStage = (typeof DUNNING_STAGES)[number]

export const MIN_PAST_DUE_GRACE_DAYS = 3
export const MAX_PAST_DUE_GRACE_DAYS = 60

const DAY_MS = 24 * 60 * 60 * 1000

export const dunningStageOffsetsDays = (graceDays: number): Record<DunningStage, number> => ({
    payment_failed: 0,
    reminder: Math.floor(graceDays / 2),
    final_warning: graceDays - 1,
    access_paused: graceDays,
})

export const dunningStageIndex = (stage: DunningStage | null): number => (stage === null ? -1 : DUNNING_STAGES.indexOf(stage))

/** The latest stage whose moment has passed; a run after downtime skips the ones it missed. */
export const resolveDunningStage = (pastDueSince: Date, now: Date, graceDays: number): DunningStage | null => {
    const elapsedMs = now.getTime() - pastDueSince.getTime()
    if (elapsedMs < 0) return null

    const offsets = dunningStageOffsetsDays(graceDays)
    let due: DunningStage | null = null
    for (const stage of DUNNING_STAGES) {
        if (elapsedMs >= offsets[stage] * DAY_MS) due = stage
    }
    return due
}
