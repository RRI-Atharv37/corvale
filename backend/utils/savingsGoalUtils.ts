import { Types } from 'mongoose'

import Account from '../models/Account'
import SavingsGoalContribution from '../models/SavingsGoalContribution'
import {
    AUTO_CONTRIBUTION_INTERVALS,
    AutoContributionInterval,
    ISavingsGoal,
    IAutoContribution,
    SavingsGoalStatus,
} from '../models/SavingsGoal'
import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'
import { fromMinorUnits, parseAmountToMinorUnits } from './moneyUtils'
import { endOfDayInTimezone, startOfDayInTimezone } from './timezoneUtils'

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

export interface SerializedAutoContribution {
    enabled: boolean
    amount: number
    interval: AutoContributionInterval
    dayOfMonth?: number
    lastContributedAt?: Date
    isDue: boolean
}

export interface SerializedSavingsGoal {
    _id: Types.ObjectId
    userId: Types.ObjectId
    workspaceId?: Types.ObjectId | null
    name: string
    targetAmount: number
    currentAmount: number
    currency: string
    targetDate?: Date | null
    status: SavingsGoalStatus
    accountId?: Types.ObjectId | null
    autoContribution: SerializedAutoContribution
    completedAt?: Date | null
    createdAt: Date
    updatedAt: Date
    progress?: SavingsGoalProgress
}

export interface SerializedContribution {
    _id: Types.ObjectId
    goalId: Types.ObjectId
    amount: number
    type: 'manual' | 'automatic'
    note?: string
    contributedAt: Date
    createdAt: Date
}

export const parseGoalAmount = (value: unknown): number => {
    try {
        const minor = parseAmountToMinorUnits(value)
        if (minor <= 0) {
            throw new Error('Amount must be greater than zero')
        }
        return minor
    } catch {
        throw new CustomError('Invalid goal amount; must be a positive number', 400)
    }
}

export const parseOptionalGoalAmount = (value: unknown): number => {
    try {
        const minor = parseAmountToMinorUnits(value)
        if (minor <= 0) {
            throw new CustomError('Invalid contribution amount; must be a positive number', 400)
        }
        return minor
    } catch {
        throw new CustomError('Invalid contribution amount; must be a positive number', 400)
    }
}

export const parseAutoContributionInterval = (value: unknown): AutoContributionInterval => {
    if (
        typeof value !== 'string' ||
        !AUTO_CONTRIBUTION_INTERVALS.includes(value as AutoContributionInterval)
    ) {
        throw new CustomError(
            `Invalid auto contribution interval. Must be one of: ${AUTO_CONTRIBUTION_INTERVALS.join(', ')}`,
            400
        )
    }
    return value as AutoContributionInterval
}

export const parseOptionalTargetDate = (
    value: unknown,
    timezone: string
): Date | null | undefined => {
    if (value === undefined) {
        return undefined
    }
    if (value === null || value === '') {
        return null
    }
    if (typeof value !== 'string') {
        throw new CustomError('targetDate must be a YYYY-MM-DD string or null', 400)
    }
    try {
        return endOfDayInTimezone(value, timezone)
    } catch {
        throw new CustomError('Invalid targetDate; use YYYY-MM-DD format', 400)
    }
}

export const validateAccountForGoal = async (
    accountId: string,
    userId: string
): Promise<Types.ObjectId> => {
    const account = await Account.findOne({ _id: accountId, userId, isArchived: false })
    if (!account) {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.INVALID_ACCOUNT_ID, 400)
    }
    return account._id
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

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

const formatDateOnly = (date: Date): string => {
    return date.toISOString().slice(0, 10)
}

export const computeMonthsRemaining = (targetDate: Date | null | undefined, now: Date): number | null => {
    if (!targetDate) {
        return null
    }
    if (targetDate.getTime() <= now.getTime()) {
        return 0
    }
    const months = diffCalendarMonths(now, targetDate)
    return Math.max(1, months === 0 ? 1 : months)
}

export const computeRequiredMonthlyContribution = (
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

export const computeAverageMonthlyContribution = async (
    goalId: Types.ObjectId,
    userId: string,
    now: Date = new Date()
): Promise<number | null> => {
    const contributions = await SavingsGoalContribution.find({ goalId, userId }).sort({
        contributedAt: 1,
    })
    if (contributions.length === 0) {
        return null
    }

    const totalMinor = contributions.reduce((sum, entry) => sum + entry.amount, 0)
    const firstAt = contributions[0].contributedAt
    const monthsElapsed = Math.max(1, diffCalendarMonths(firstAt, now) + 1)
    const avgMinor = Math.ceil(totalMinor / monthsElapsed)
    return fromMinorUnits(avgMinor)
}

export const computeProjectedCompletionDate = async (
    goal: ISavingsGoal,
    now: Date = new Date()
): Promise<string | null> => {
    const remainingMinor = Math.max(0, goal.targetAmount - goal.currentAmount)
    if (remainingMinor === 0) {
        return formatDateOnly(now)
    }

    let monthlyMinor: number | null = null

    if (goal.autoContribution.enabled && goal.autoContribution.amount > 0) {
        monthlyMinor = goal.autoContribution.amount
    } else {
        const avgMajor = await computeAverageMonthlyContribution(
            goal._id,
            goal.userId.toString(),
            now
        )
        if (avgMajor !== null) {
            monthlyMinor = Math.round(avgMajor * 100)
        }
    }

    if (!monthlyMinor || monthlyMinor <= 0) {
        return null
    }

    const monthsNeeded = Math.ceil(remainingMinor / monthlyMinor)
    const projected = addMonthsUtc(now, monthsNeeded)
    return formatDateOnly(projected)
}

export const computeSavingsGoalProgress = async (
    goal: ISavingsGoal,
    now: Date = new Date()
): Promise<SavingsGoalProgress> => {
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
        requiredMonthlyContribution: computeRequiredMonthlyContribution(
            goal.targetAmount,
            goal.currentAmount,
            goal.targetDate,
            now
        ),
        projectedCompletionDate: await computeProjectedCompletionDate(goal, now),
        monthsRemaining: computeMonthsRemaining(goal.targetDate, now),
    }
}

export const isAutoContributionDue = (
    autoContribution: IAutoContribution,
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
    const currentMonthStart = startOfDayInTimezone(
        `${todayStr.slice(0, 7)}-01`,
        timezone
    )

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

export const serializeAutoContribution = (
    autoContribution: IAutoContribution,
    timezone: string,
    now: Date = new Date()
): SerializedAutoContribution => {
    return {
        enabled: autoContribution.enabled,
        amount: fromMinorUnits(autoContribution.amount),
        interval: autoContribution.interval,
        dayOfMonth: autoContribution.dayOfMonth,
        lastContributedAt: autoContribution.lastContributedAt,
        isDue: isAutoContributionDue(autoContribution, timezone, now),
    }
}

export const serializeSavingsGoal = async (
    goal: ISavingsGoal,
    timezone: string,
    includeProgress = true
): Promise<SerializedSavingsGoal> => {
    const progress = includeProgress ? await computeSavingsGoalProgress(goal) : undefined

    return {
        ...(goal.toObject() as SerializedSavingsGoal),
        targetAmount: fromMinorUnits(goal.targetAmount),
        currentAmount: fromMinorUnits(goal.currentAmount),
        autoContribution: serializeAutoContribution(goal.autoContribution, timezone),
        progress,
    }
}

export const serializeSavingsGoals = async (
    goals: ISavingsGoal[],
    timezone: string
): Promise<SerializedSavingsGoal[]> => {
    return Promise.all(goals.map((goal) => serializeSavingsGoal(goal, timezone)))
}

export const serializeContribution = (contribution: {
    _id: Types.ObjectId
    goalId: Types.ObjectId
    amount: number
    type: 'manual' | 'automatic'
    note?: string
    contributedAt: Date
    createdAt: Date
}): SerializedContribution => {
    return {
        _id: contribution._id,
        goalId: contribution.goalId,
        amount: fromMinorUnits(contribution.amount),
        type: contribution.type,
        note: contribution.note,
        contributedAt: contribution.contributedAt,
        createdAt: contribution.createdAt,
    }
}

export const assertGoalAcceptsContributions = (goal: ISavingsGoal): void => {
    if (goal.status === 'archived') {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.GOAL_ARCHIVED, 400)
    }
    if (goal.status === 'completed') {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.GOAL_COMPLETED, 400)
    }
    if (goal.status === 'paused') {
        throw new CustomError(ERROR_MESSAGES.SAVINGS_GOAL.GOAL_PAUSED, 400)
    }
}

export const markGoalCompletedIfTargetMet = (goal: ISavingsGoal): void => {
    if (goal.currentAmount >= goal.targetAmount && goal.status === 'active') {
        goal.status = 'completed'
        goal.completedAt = new Date()
    }
}

export const parseAutoContributionFromBody = (
    body: Record<string, unknown>,
    existing?: IAutoContribution
): IAutoContribution | undefined => {
    if (body.autoContribution === undefined) {
        return undefined
    }

    if (body.autoContribution === null || typeof body.autoContribution !== 'object') {
        throw new CustomError('autoContribution must be an object', 400)
    }

    const input = body.autoContribution as Record<string, unknown>
    const base = existing ?? {
        enabled: false,
        amount: 0,
        interval: 'monthly' as AutoContributionInterval,
    }

    const next: IAutoContribution = { ...base }

    if (input.enabled !== undefined) {
        next.enabled = input.enabled === true
    }

    if (input.amount !== undefined) {
        next.amount = parseGoalAmount(input.amount)
    }

    if (input.interval !== undefined) {
        next.interval = parseAutoContributionInterval(input.interval)
    }

    if (input.dayOfMonth !== undefined) {
        if (input.dayOfMonth === null) {
            delete next.dayOfMonth
        } else {
            const day = Number(input.dayOfMonth)
            if (!Number.isInteger(day) || day < 1 || day > 28) {
                throw new CustomError('dayOfMonth must be an integer between 1 and 28', 400)
            }
            next.dayOfMonth = day
        }
    }

    if (next.enabled && next.amount <= 0) {
        throw new CustomError(
            'Auto contribution amount must be greater than zero when enabled',
            400
        )
    }

    return next
}
