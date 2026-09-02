import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import Budget, { IBudget } from '../models/Budget'
import RecurringRule, { IRecurringRule } from '../models/RecurringRule'
import SavingsGoal, { ISavingsGoal } from '../models/SavingsGoal'
import { AuthRequest } from '@core/auth/authTypes'
import { CustomError } from '@core/errors/customError'
import { DEFAULT_TIMEZONE, resolveDateRange } from '@core/time/timezoneUtils'
import { assertWorkspaceMembership, buildScopedListFilter, parseOptionalWorkspaceId } from '@core/access/workspace'
import {
    buildBudgetEvent as sharedBuildBudgetEvent,
    buildGoalEvent as sharedBuildGoalEvent,
    buildRecurringEvents as sharedBuildRecurringEvents,
} from '@shared/calendar'
import type { CalendarEvent, CalendarEventType } from '@shared/calendar'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'
import { validateRequiredFields } from '@core/http/validation'

export type { CalendarEvent, CalendarEventType }

const getUserTimezone = (req: AuthRequest): string => {
    return req.user?.timezone?.trim() || DEFAULT_TIMEZONE
}

const buildRecurringEvents = (rule: IRecurringRule, rangeStart: Date, rangeEnd: Date): CalendarEvent[] => {
    return sharedBuildRecurringEvents(
        {
            id: rule._id.toString(),
            title: rule.title,
            amount: rule.amount,
            accountId: rule.accountId.toString(),
            categoryId: rule.categoryId.toString(),
            nextDueDate: rule.nextDueDate,
            interval: rule.interval,
            customIntervalDays: rule.customIntervalDays,
        },
        rangeStart,
        rangeEnd
    )
}

const buildBudgetEvent = (budget: IBudget): CalendarEvent => {
    return sharedBuildBudgetEvent({
        id: budget._id.toString(),
        name: budget.name,
        amount: budget.amount,
        periodEnd: budget.periodEnd,
        categoryId: budget.categoryId ? budget.categoryId.toString() : undefined,
    })
}

const buildGoalEvent = (goal: ISavingsGoal): CalendarEvent => {
    return sharedBuildGoalEvent({
        id: goal._id.toString(),
        name: goal.name,
        targetAmount: goal.targetAmount,
        targetDate: goal.targetDate as Date,
        accountId: goal.accountId ? goal.accountId.toString() : undefined,
    })
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
