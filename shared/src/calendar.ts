import { fromMinorUnits } from './money'
import { projectRecurringOccurrences, RecurringLike } from './forecast'

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

export const formatDateOnly = (date: Date): string => date.toISOString().slice(0, 10)

export interface RecurringRuleLike extends RecurringLike {
    id: string
    title: string
    amount: number
    accountId: string
    categoryId: string
}

export const buildRecurringEvents = (
    rule: RecurringRuleLike,
    rangeStart: Date,
    rangeEnd: Date
): CalendarEvent[] => {
    const occurrences = projectRecurringOccurrences(rule, rangeStart, rangeEnd)
    return occurrences.map((date) => {
        const dateStr = formatDateOnly(date)
        return {
            id: `recurring-${rule.id}-${dateStr}`,
            type: 'recurring',
            date: dateStr,
            title: rule.title,
            amount: fromMinorUnits(rule.amount),
            refId: rule.id,
            accountId: rule.accountId,
            categoryId: rule.categoryId,
        }
    })
}

export interface CalendarBudgetLike {
    id: string
    name?: string
    amount: number
    periodEnd: Date
    categoryId?: string
}

export const buildBudgetEvent = (budget: CalendarBudgetLike): CalendarEvent => {
    return {
        id: `budget-${budget.id}`,
        type: 'budget_end',
        date: formatDateOnly(budget.periodEnd),
        title: budget.name || 'Budget period end',
        amount: fromMinorUnits(budget.amount),
        refId: budget.id,
        categoryId: budget.categoryId,
    }
}

export interface SavingsGoalLike {
    id: string
    name: string
    targetAmount: number
    targetDate: Date
    accountId?: string
}

export const buildGoalEvent = (goal: SavingsGoalLike): CalendarEvent => {
    return {
        id: `goal-${goal.id}`,
        type: 'goal_deadline',
        date: formatDateOnly(goal.targetDate),
        title: goal.name,
        amount: fromMinorUnits(goal.targetAmount),
        refId: goal.id,
        accountId: goal.accountId,
    }
}
