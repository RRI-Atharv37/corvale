import { DEFAULT_CURRENCY } from './currencies'

export const formatCurrency = (amount: number, currency: string = DEFAULT_CURRENCY): string =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)

export const toDateInputValue = (date: string | Date): string => {
    const d = typeof date === 'string' ? new Date(date) : date
    return d.toISOString().split('T')[0]
}

export const formatBudgetPeriod = (
    periodStart: string,
    periodEnd: string,
    periodType: 'monthly' | 'custom'
): string => {
    if (periodType === 'monthly') {
        const start = new Date(periodStart)
        return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    }
    return `${toDateInputValue(periodStart)} – ${toDateInputValue(periodEnd)}`
}

export const getCurrentMonthYear = (): { year: number; month: number } => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

export const formatGoalTargetDate = (targetDate: string | null | undefined): string => {
    if (!targetDate) return 'No target date'
    const date = new Date(targetDate)
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
    })
}

export const formatContributionDate = (date: string): string => {
    return new Date(date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })
}
