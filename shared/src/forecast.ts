import { RecurringInterval } from './types'
import { advanceNextDueDate } from './categorization'

export type ForecastChangeType = 'recurring' | 'goal' | 'discretionary'

export interface ProjectedChange {
    date: string
    type: ForecastChangeType
    amount: number
    label: string
    refId?: string
}

export interface LowBalanceWarning {
    date: string
    projectedBalance: number
}

const MAX_PROJECTION_ITERATIONS = 400

export interface RecurringLike {
    nextDueDate: Date
    interval: RecurringInterval
    customIntervalDays?: number
}

/** Project recurring rule occurrence dates that fall within [rangeStart, rangeEnd], catching up any overdue occurrences first. */
export const projectRecurringOccurrences = (
    rule: RecurringLike,
    rangeStart: Date,
    rangeEnd: Date
): Date[] => {
    const occurrences: Date[] = []
    let current = new Date(rule.nextDueDate)
    let iterations = 0

    while (current.getTime() < rangeStart.getTime() && iterations < MAX_PROJECTION_ITERATIONS) {
        current = advanceNextDueDate(current, rule.interval, rule.customIntervalDays, 'UTC')
        iterations += 1
    }

    while (current.getTime() <= rangeEnd.getTime() && iterations < MAX_PROJECTION_ITERATIONS) {
        occurrences.push(new Date(current))
        current = advanceNextDueDate(current, rule.interval, rule.customIntervalDays, 'UTC')
        iterations += 1
    }

    return occurrences
}

/** Mirrors backend `AutoContributionInterval` (`SavingsGoal.ts`) without importing the Mongoose model. */
export type AutoContributionIntervalLike = 'weekly' | 'monthly'

export interface ForecastAutoContributionLike {
    enabled: boolean
    amount: number
    interval: AutoContributionIntervalLike
    lastContributedAt?: Date
}

/** Project savings-goal auto-contribution dates within [rangeStart, rangeEnd]. */
export const projectGoalContributionDates = (
    autoContribution: ForecastAutoContributionLike,
    rangeStart: Date,
    rangeEnd: Date
): Date[] => {
    if (!autoContribution.enabled || autoContribution.amount <= 0) {
        return []
    }

    const interval = autoContribution.interval as RecurringInterval
    let current = autoContribution.lastContributedAt
        ? advanceNextDueDate(autoContribution.lastContributedAt, interval, undefined, 'UTC')
        : new Date(rangeStart)

    const occurrences: Date[] = []
    let iterations = 0

    while (current.getTime() < rangeStart.getTime() && iterations < MAX_PROJECTION_ITERATIONS) {
        current = advanceNextDueDate(current, interval, undefined, 'UTC')
        iterations += 1
    }

    while (current.getTime() <= rangeEnd.getTime() && iterations < MAX_PROJECTION_ITERATIONS) {
        occurrences.push(new Date(current))
        current = advanceNextDueDate(current, interval, undefined, 'UTC')
        iterations += 1
    }

    return occurrences
}

/** Average minor-unit daily spend given a trailing total and lookback window length. */
export const computeDiscretionaryDailyAverage = (totalMinor: number, lookbackDays: number): number => {
    if (totalMinor <= 0 || lookbackDays <= 0) {
        return 0
    }
    return Math.round(totalMinor / lookbackDays)
}
