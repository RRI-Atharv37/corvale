import { RecurringInterval } from '../models/RecurringRule'
import { AutoContributionInterval } from '../models/SavingsGoal'
import { advanceNextDueDate } from './recurringRuleUtils'

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

interface RecurringLike {
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
        current = advanceNextDueDate(current, rule.interval, rule.customIntervalDays)
        iterations += 1
    }

    while (current.getTime() <= rangeEnd.getTime() && iterations < MAX_PROJECTION_ITERATIONS) {
        occurrences.push(new Date(current))
        current = advanceNextDueDate(current, rule.interval, rule.customIntervalDays)
        iterations += 1
    }

    return occurrences
}

interface AutoContributionLike {
    enabled: boolean
    amount: number
    interval: AutoContributionInterval
    lastContributedAt?: Date
}

/** Project savings-goal auto-contribution dates within [rangeStart, rangeEnd]. */
export const projectGoalContributionDates = (
    autoContribution: AutoContributionLike,
    rangeStart: Date,
    rangeEnd: Date
): Date[] => {
    if (!autoContribution.enabled || autoContribution.amount <= 0) {
        return []
    }

    const interval = autoContribution.interval as RecurringInterval
    let current = autoContribution.lastContributedAt
        ? advanceNextDueDate(autoContribution.lastContributedAt, interval)
        : new Date(rangeStart)

    const occurrences: Date[] = []
    let iterations = 0

    while (current.getTime() < rangeStart.getTime() && iterations < MAX_PROJECTION_ITERATIONS) {
        current = advanceNextDueDate(current, interval)
        iterations += 1
    }

    while (current.getTime() <= rangeEnd.getTime() && iterations < MAX_PROJECTION_ITERATIONS) {
        occurrences.push(new Date(current))
        current = advanceNextDueDate(current, interval)
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
