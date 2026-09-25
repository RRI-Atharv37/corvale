export const LIFECYCLE_EMAIL_STAGES = [
    'trial_welcome',
    'trial_day_7',
    'trial_day_21',
    'trial_ending',
    'trial_expired',
    'win_back',
] as const
export type LifecycleEmailStage = (typeof LIFECYCLE_EMAIL_STAGES)[number]

export const TRIAL_ENDING_LEAD_DAYS = 2
export const WIN_BACK_DELAY_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000

export const lifecycleStageIndex = (stage: LifecycleEmailStage | null): number =>
    stage === null ? -1 : LIFECYCLE_EMAIL_STAGES.indexOf(stage)

/**
 * The latest trial stage whose moment has passed; a run after downtime skips the ones it missed.
 * The "ending" stage counts back from the real end date, so an extended trial is not told it is
 * about to end at day 28.
 */
export const resolveTrialLifecycleStage = (trialStartedAt: Date, trialEndsAt: Date, now: Date): LifecycleEmailStage | null => {
    const elapsedMs = now.getTime() - trialStartedAt.getTime()
    if (elapsedMs < 0) return null

    if (now.getTime() >= trialEndsAt.getTime()) return 'trial_expired'
    if (trialEndsAt.getTime() - now.getTime() <= TRIAL_ENDING_LEAD_DAYS * DAY_MS) return 'trial_ending'
    if (elapsedMs >= 21 * DAY_MS) return 'trial_day_21'
    if (elapsedMs >= 7 * DAY_MS) return 'trial_day_7'
    return 'trial_welcome'
}

export const resolveWinBackDue = (lapsedAt: Date, now: Date): boolean =>
    now.getTime() - lapsedAt.getTime() >= WIN_BACK_DELAY_DAYS * DAY_MS
