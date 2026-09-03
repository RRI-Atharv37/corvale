import type { RecurringInterval, RecurringRule } from '@features/recurring/types'
import { toDateInputValue } from '@lib/format'

export const INTERVAL_OPTIONS: { value: RecurringInterval; label: string }[] = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'biweekly', label: 'Biweekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'yearly', label: 'Yearly' },
    { value: 'custom', label: 'Custom' },
]

export const INTERVAL_LABELS: Record<RecurringInterval, string> = {
    daily: 'Daily',
    weekly: 'Weekly',
    biweekly: 'Biweekly',
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    yearly: 'Yearly',
    custom: 'Custom',
}

export const formatIntervalLabel = (
    interval: RecurringInterval,
    customIntervalDays?: number
): string => {
    if (interval === 'custom' && customIntervalDays) {
        return `Every ${customIntervalDays} day${customIntervalDays === 1 ? '' : 's'}`
    }
    return INTERVAL_LABELS[interval]
}

export const advanceNextDueDate = (
    current: Date,
    interval: RecurringInterval,
    customIntervalDays?: number
): Date => {
    const next = new Date(current)

    switch (interval) {
        case 'daily':
            next.setUTCDate(next.getUTCDate() + 1)
            break
        case 'weekly':
            next.setUTCDate(next.getUTCDate() + 7)
            break
        case 'biweekly':
            next.setUTCDate(next.getUTCDate() + 14)
            break
        case 'monthly':
            next.setUTCMonth(next.getUTCMonth() + 1)
            break
        case 'quarterly':
            next.setUTCMonth(next.getUTCMonth() + 3)
            break
        case 'yearly':
            next.setUTCFullYear(next.getUTCFullYear() + 1)
            break
        case 'custom':
            next.setUTCDate(next.getUTCDate() + (customIntervalDays ?? 1))
            break
    }

    return next
}

export interface ProjectedOccurrence {
    ruleId: string
    title: string
    type: RecurringRule['type']
    amount: number
    currency: string
    date: string
    isDraft?: boolean
    transactionId?: string
}

const isDateInMonth = (date: Date, year: number, month: number): boolean => {
    return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month
}

export const projectRuleOccurrencesInMonth = (
    rule: RecurringRule,
    year: number,
    month: number,
    maxIterations = 31
): ProjectedOccurrence[] => {
    if (!rule.isActive || rule.isArchived) {
        return []
    }

    const occurrences: ProjectedOccurrence[] = []
    let cursor = new Date(rule.nextDueDate)
    let iterations = 0

    const monthStart = new Date(Date.UTC(year, month - 1, 1))
    while (cursor < monthStart && iterations < maxIterations) {
        cursor = advanceNextDueDate(cursor, rule.interval, rule.customIntervalDays)
        iterations += 1
    }

    while (isDateInMonth(cursor, year, month) && iterations < maxIterations) {
        occurrences.push({
            ruleId: rule._id,
            title: rule.title,
            type: rule.type,
            amount: rule.amount,
            currency: rule.currency,
            date: toDateInputValue(cursor),
        })
        cursor = advanceNextDueDate(cursor, rule.interval, rule.customIntervalDays)
        iterations += 1
    }

    return occurrences
}

export interface CalendarCell {
    date: string
    day: number
    inMonth: boolean
}

export const buildCalendarGrid = (year: number, month: number): CalendarCell[] => {
    const firstDay = new Date(Date.UTC(year, month - 1, 1))
    const startWeekday = firstDay.getUTCDay()
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()

    const cells: CalendarCell[] = []

    const prevMonthDays = new Date(Date.UTC(year, month - 1, 0)).getUTCDate()
    for (let i = startWeekday - 1; i >= 0; i -= 1) {
        const day = prevMonthDays - i
        const date = new Date(Date.UTC(year, month - 2, day))
        cells.push({
            date: toDateInputValue(date),
            day,
            inMonth: false,
        })
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
        const date = new Date(Date.UTC(year, month - 1, day))
        cells.push({
            date: toDateInputValue(date),
            day,
            inMonth: true,
        })
    }

    while (cells.length % 7 !== 0) {
        const nextDay = cells.length - (startWeekday + daysInMonth) + 1
        const date = new Date(Date.UTC(year, month, nextDay))
        cells.push({
            date: toDateInputValue(date),
            day: nextDay,
            inMonth: false,
        })
    }

    return cells
}

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
