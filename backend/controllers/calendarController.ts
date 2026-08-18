import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import Budget, { IBudget } from '../models/Budget'
import RecurringRule, { IRecurringRule } from '../models/RecurringRule'
import SavingsGoal, { ISavingsGoal } from '../models/SavingsGoal'
import { AuthRequest } from '../middleware/authTypes'
import { CustomError } from '../utils/customError'
import { projectRecurringOccurrences } from '../utils/forecastUtils'
import { fromMinorUnits } from '../utils/moneyUtils'
import { getUserId, handleResponses, validateRequiredFields } from '../utils/sharedUtils'
import { DEFAULT_TIMEZONE, resolveDateRange } from '../utils/timezoneUtils'
import { assertWorkspaceMembership, buildScopedListFilter, parseOptionalWorkspaceId } from '../utils/workspaceUtils'

export type CalendarEventType = 'recurring' | 'budget_end' | 'goal_deadline'

export interface CalendarEvent {
    id: string
    type: CalendarEventType
    date: string
    title: string
    amount?: number
    refId: string
    accountId?: string
    categoryId?: string
}

const formatDateOnly = (date: Date): string => date.toISOString().slice(0, 10)

const getUserTimezone = (req: AuthRequest): string => {
    return req.user?.timezone?.trim() || DEFAULT_TIMEZONE
}

const buildRecurringEvents = (rule: IRecurringRule, rangeStart: Date, rangeEnd: Date): CalendarEvent[] => {
    const occurrences = projectRecurringOccurrences(rule, rangeStart, rangeEnd)
    return occurrences.map((date) => {
        const dateStr = formatDateOnly(date)
        return {
            id: `recurring-${rule._id.toString()}-${dateStr}`,
            type: 'recurring',
            date: dateStr,
            title: rule.title,
            amount: fromMinorUnits(rule.amount),
            refId: rule._id.toString(),
            accountId: rule.accountId.toString(),
            categoryId: rule.categoryId.toString(),
        }
    })
}

const buildBudgetEvent = (budget: IBudget): CalendarEvent => {
    return {
        id: `budget-${budget._id.toString()}`,
        type: 'budget_end',
        date: formatDateOnly(budget.periodEnd),
        title: budget.name || 'Budget period end',
        amount: fromMinorUnits(budget.amount),
        refId: budget._id.toString(),
        categoryId: budget.categoryId ? budget.categoryId.toString() : undefined,
    }
}

const buildGoalEvent = (goal: ISavingsGoal): CalendarEvent => {
    return {
        id: `goal-${goal._id.toString()}`,
        type: 'goal_deadline',
        date: formatDateOnly(goal.targetDate as Date),
        title: goal.name,
        amount: fromMinorUnits(goal.targetAmount),
        refId: goal._id.toString(),
        accountId: goal.accountId ? goal.accountId.toString() : undefined,
    }
}

export const getCalendar = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { start, end } = req.query

    validateRequiredFields({ start, end }, ['start', 'end'])

    const workspaceId = parseOptionalWorkspaceId(req.query.workspaceId) ?? null
    if (workspaceId) {
        await assertWorkspaceMembership(workspaceId, userId, 'viewer')
    }

    const timezone = getUserTimezone(req)

    let range: { start: Date; end: Date }
    try {
        range = resolveDateRange(start as string, end as string, timezone)
    } catch {
        throw new CustomError('Invalid start/end date range; use YYYY-MM-DD with start on or before end', 400)
    }

    const scopeFilter = buildScopedListFilter(userId, workspaceId)

    const [rules, budgets, goals] = await Promise.all([
        RecurringRule.find({ ...scopeFilter, isActive: true, isArchived: false }),
        Budget.find({
            ...scopeFilter,
            isArchived: false,
            periodEnd: { $gte: range.start, $lte: range.end },
        }),
        SavingsGoal.find({
            ...scopeFilter,
            status: { $in: ['active', 'paused'] },
            targetDate: { $ne: null, $gte: range.start, $lte: range.end },
        }),
    ])

    const events: CalendarEvent[] = [
        ...rules.flatMap((rule) => buildRecurringEvents(rule, range.start, range.end)),
        ...budgets.map(buildBudgetEvent),
        ...goals.map(buildGoalEvent),
    ]

    events.sort((a, b) => a.date.localeCompare(b.date))

    handleResponses(res, 200, events)
})
