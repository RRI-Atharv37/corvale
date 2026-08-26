import { TransactionStatus, TransactionType } from './types'
import { fromMinorUnits } from './money'
import { endOfDayInTimezone, resolveDateRange, startOfDayInTimezone } from './timezone'

export interface BudgetProgress {
    spent: number
    remaining: number
    percentUsed: number
    isOverBudget: boolean
    budgetAmount: number
}

const padMonth = (month: number): string => String(month).padStart(2, '0')

const lastDayOfMonth = (year: number, month: number): number => {
    return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export const resolveMonthlyPeriod = (
    year: number,
    month: number,
    timezone: string
): { periodStart: Date; periodEnd: Date } => {
    if (!Number.isInteger(year) || year < 1970 || year > 9999) {
        throw new Error('Invalid year for monthly budget')
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
        throw new Error('Invalid month for monthly budget; must be 1–12')
    }

    const startDateStr = `${year}-${padMonth(month)}-01`
    const endDay = lastDayOfMonth(year, month)
    const endDateStr = `${year}-${padMonth(month)}-${String(endDay).padStart(2, '0')}`

    return {
        periodStart: startOfDayInTimezone(startDateStr, timezone),
        periodEnd: endOfDayInTimezone(endDateStr, timezone),
    }
}

export const resolveCustomPeriod = (
    periodStart: string,
    periodEnd: string,
    timezone: string
): { periodStart: Date; periodEnd: Date } => {
    try {
        const range = resolveDateRange(periodStart, periodEnd, timezone)
        return { periodStart: range.start, periodEnd: range.end }
    } catch {
        throw new Error('Invalid custom period; use YYYY-MM-DD dates with start on or before end')
    }
}

export const computeBudgetProgress = (
    budgetAmountMinor: number,
    spentMinor: number
): BudgetProgress => {
    const budgetAmount = fromMinorUnits(budgetAmountMinor)
    const spent = fromMinorUnits(spentMinor)
    const remaining = Math.round((budgetAmount - spent + Number.EPSILON) * 100) / 100
    const percentUsed =
        budgetAmountMinor > 0 ? Math.round((spentMinor / budgetAmountMinor) * 10000) / 100 : 0

    return {
        spent,
        remaining,
        percentUsed,
        isOverBudget: spentMinor > budgetAmountMinor,
        budgetAmount,
    }
}

export interface BudgetTransactionLike {
    _id: string
    accountId: string
    categoryId: string
    type: TransactionType
    status: TransactionStatus
    amount: number
    date: Date
    splitTransactionId: string | null
}

export interface BudgetLike {
    categoryId: string | null
    periodStart: Date
    periodEnd: Date
    accountIds: string[]
}

/**
 * Sums posted expense minor units that count toward a budget, from an
 * in-memory transaction list. Mirrors the split-children rule exactly: a
 * split child matching the budget's category counts; its parent is excluded
 * once it has children (to avoid double counting), but an ordinary
 * non-split transaction in the category still counts. Drafts and transfers
 * never count.
 */
export const computeBudgetSpentMinorPure = (
    budget: BudgetLike,
    transactions: BudgetTransactionLike[]
): number => {
    const accountIdSet = budget.accountIds.length > 0 ? new Set(budget.accountIds) : null

    const inScope = transactions.filter((tx) => {
        if (tx.type !== 'expense' || tx.status !== 'posted') return false
        if (tx.date < budget.periodStart || tx.date > budget.periodEnd) return false
        if (accountIdSet && !accountIdSet.has(tx.accountId)) return false
        return true
    })

    if (budget.categoryId) {
        const parentIds = new Set(
            transactions
                .filter((tx) => tx.splitTransactionId !== null)
                .map((tx) => tx.splitTransactionId as string)
        )

        return inScope
            .filter((tx) => tx.categoryId === budget.categoryId)
            .filter((tx) => tx.splitTransactionId !== null || !parentIds.has(tx._id))
            .reduce((sum, tx) => sum + tx.amount, 0)
    }

    return inScope
        .filter((tx) => tx.splitTransactionId === null)
        .reduce((sum, tx) => sum + tx.amount, 0)
}
