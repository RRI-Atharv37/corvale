import { fromMinorUnits } from './money'
import { startOfDayInTimezone } from './timezone'

export type SavingsGoalStatus = 'active' | 'paused' | 'completed' | 'archived'
export type AutoContributionInterval = 'weekly' | 'monthly'

export interface GoalLike {
    targetAmount: number
    currentAmount: number
    targetDate: Date | null
    status: SavingsGoalStatus
    autoContribution: {
        enabled: boolean
        amount: number
        interval: AutoContributionInterval
    }
}

export interface ContributionLike {
    amount: number
    contributedAt: Date
}

export interface SavingsGoalProgress {
    currentAmount: number
    targetAmount: number
    remaining: number
    percentComplete: number
    isComplete: boolean
    requiredMonthlyContribution: number | null
    projectedCompletionDate: string | null
    monthsRemaining: number | null
}

const diffCalendarMonths = (from: Date, to: Date): number => {
    const fromYear = from.getUTCFullYear()
    const fromMonth = from.getUTCMonth()
    const toYear = to.getUTCFullYear()
    const toMonth = to.getUTCMonth()
    return (toYear - fromYear) * 12 + (toMonth - fromMonth)
}

const addMonthsUtc = (date: Date, months: number): Date => {
    const result = new Date(date)
    result.setUTCMonth(result.getUTCMonth() + months)
    return result
}

const formatDateOnly = (date: Date): string => date.toISOString().slice(0, 10)

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface AutoContributionLike {
    enabled: boolean
    amount: number
    interval: AutoContributionInterval
    dayOfMonth?: number
    lastContributedAt?: Date
}

export const computeMonthsRemaining = (
    targetDate: Date | null | undefined,
    now: Date
): number | null => {
    if (!targetDate) {
        return null
    }
    if (targetDate.getTime() <= now.getTime()) {
        return 0
    }
    const months = diffCalendarMonths(now, targetDate)
    return Math.max(1, months === 0 ? 1 : months)
}

export const computeRequiredMonthlyContributionPure = (
    targetAmountMinor: number,
    currentAmountMinor: number,
    targetDate: Date | null | undefined,
    now: Date = new Date()
): number | null => {
    const remainingMinor = Math.max(0, targetAmountMinor - currentAmountMinor)
    if (remainingMinor === 0) {
        return 0
    }

    const monthsRemaining = computeMonthsRemaining(targetDate, now)
    if (monthsRemaining === null) {
        return null
    }
    if (monthsRemaining === 0) {
        return fromMinorUnits(remainingMinor)
    }

    const monthlyMinor = Math.ceil(remainingMinor / monthsRemaining)
    return fromMinorUnits(monthlyMinor)
}

export const computeAverageMonthlyContributionPure = (
    contributions: ContributionLike[],
    now: Date = new Date()
): number | null => {
    if (contributions.length === 0) {
        return null
    }

    const sorted = [...contributions].sort(
        (a, b) => a.contributedAt.getTime() - b.contributedAt.getTime()
    )
    const totalMinor = sorted.reduce((sum, entry) => sum + entry.amount, 0)
    const firstAt = sorted[0].contributedAt
    const monthsElapsed = Math.max(1, diffCalendarMonths(firstAt, now) + 1)
    const avgMinor = Math.ceil(totalMinor / monthsElapsed)
    return fromMinorUnits(avgMinor)
}

export const computeProjectedCompletionDatePure = (
    goal: GoalLike,
    contributions: ContributionLike[],
    now: Date = new Date()
): string | null => {
    const remainingMinor = Math.max(0, goal.targetAmount - goal.currentAmount)
    if (remainingMinor === 0) {
        return formatDateOnly(now)
    }

    let monthlyMinor: number | null = null

    if (goal.autoContribution.enabled && goal.autoContribution.amount > 0) {
        monthlyMinor = goal.autoContribution.amount
    } else {
        const avgMajor = computeAverageMonthlyContributionPure(contributions, now)
        if (avgMajor !== null) {
            monthlyMinor = Math.round(avgMajor * 100)
        }
    }

    if (!monthlyMinor || monthlyMinor <= 0) {
        return null
    }

    const monthsNeeded = Math.ceil(remainingMinor / monthlyMinor)
    return formatDateOnly(addMonthsUtc(now, monthsNeeded))
}

export const isAutoContributionDuePure = (
    autoContribution: AutoContributionLike,
    timezone: string,
    now: Date = new Date()
): boolean => {
    if (!autoContribution.enabled || autoContribution.amount <= 0) {
        return false
    }

    if (!autoContribution.lastContributedAt) {
        return true
    }

    const last = autoContribution.lastContributedAt

    if (autoContribution.interval === 'weekly') {
        return now.getTime() - last.getTime() >= 7 * MS_PER_DAY
    }

    const todayStr = formatDateOnly(now)
    const currentMonthStart = startOfDayInTimezone(`${todayStr.slice(0, 7)}-01`, timezone)

    if (autoContribution.dayOfMonth) {
        const day = Math.min(autoContribution.dayOfMonth, 28)
        const dueStr = `${todayStr.slice(0, 7)}-${String(day).padStart(2, '0')}`
        const dueDate = startOfDayInTimezone(dueStr, timezone)
        if (now.getTime() < dueDate.getTime()) {
            return false
        }
    }

    return last.getTime() < currentMonthStart.getTime()
}

export const computeSavingsGoalProgressPure = (
    goal: GoalLike,
    contributions: ContributionLike[],
    now: Date = new Date()
): SavingsGoalProgress => {
    const currentAmount = fromMinorUnits(goal.currentAmount)
    const targetAmount = fromMinorUnits(goal.targetAmount)
    const remainingMinor = Math.max(0, goal.targetAmount - goal.currentAmount)
    const remaining = fromMinorUnits(remainingMinor)
    const percentComplete =
        goal.targetAmount > 0
            ? Math.round((goal.currentAmount / goal.targetAmount) * 10000) / 100
            : 0
    const isComplete = goal.currentAmount >= goal.targetAmount || goal.status === 'completed'

    return {
        currentAmount,
        targetAmount,
        remaining,
        percentComplete: Math.min(percentComplete, 100),
        isComplete,
        requiredMonthlyContribution: computeRequiredMonthlyContributionPure(
            goal.targetAmount,
            goal.currentAmount,
            goal.targetDate,
            now
        ),
        projectedCompletionDate: computeProjectedCompletionDatePure(goal, contributions, now),
        monthsRemaining: computeMonthsRemaining(goal.targetDate, now),
    }
}
