import { Types } from 'mongoose'

import Budget from '../models/Budget'
import Account from '../models/Account'
import Category from '../models/Category'
import Transaction from '../models/Transaction'
import { computeAccountTotals, computeUserBalances } from './balanceUtils'
import {
    attachProgressToBudgets,
    resolveMonthlyPeriod,
    SerializedBudget,
} from './budgetUtils'
import { CustomError } from './customError'
import { fromMinorUnits } from './moneyUtils'
import { DEFAULT_TIMEZONE, resolveDateRange } from './timezoneUtils'
import { buildScopedListFilter } from './workspaceUtils'

export const DASHBOARD_GROUP_BY_VALUES = ['day', 'week', 'month'] as const
export type DashboardGroupBy = (typeof DASHBOARD_GROUP_BY_VALUES)[number]

const POSTED_LEDGER_FILTER = {
    status: 'posted' as const,
    splitTransactionId: null,
}

export interface DashboardSummary {
    netWorth: number
    totalAccountBalance: number
    accountCount: number
    balanceSource: 'accounts' | 'legacy'
    spendableBalance: number
    saverBalance: number
    netSavings: number
    totalIncome: number
    totalExpenses: number
    averageIncomePerMonth: number
    averageExpensePerMonth: number
    averageIncomePerTransaction: number
    averageExpensePerTransaction: number
    incomeTransactionCount: number
    expenseTransactionCount: number
    monthCount: number
    periodStart: string
    periodEnd: string
}

export interface NetWorthPoint {
    period: string
    netWorth: number
    cumulativeIncome: number
    cumulativeExpense: number
}

export interface BalanceBreakdown {
    liquid: number
    savings: number
    credit: number
    saver: number
    spendable: number
    netWorth: number
}

export interface NetWorthTrendResponse {
    series: NetWorthPoint[]
    currentBalances: BalanceBreakdown
    balanceSource: 'accounts' | 'legacy'
    periodStart: string
    periodEnd: string
}

export interface BudgetOverviewItem {
    budgetId: string
    name?: string
    categoryName?: string
    budgetAmount: number
    spent: number
    remaining: number
    percentUsed: number
    isOverBudget: boolean
}

export interface BudgetOverviewResponse {
    periodStart: string
    periodEnd: string
    budgets: BudgetOverviewItem[]
}

export interface PaymentMethodBreakdownItem {
    paymentMethod: string
    amount: number
}

export interface CashFlowPoint {
    period: string
    income: number
    expense: number
    net: number
}

export interface CategoryBreakdownItem {
    categoryId: string
    categoryName: string
    amount: number
    color?: string
}

const padMonth = (month: number): string => String(month).padStart(2, '0')
const padDay = (day: number): string => String(day).padStart(2, '0')

const formatDateOnlyInTimezone = (date: Date, timezone: string): string => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date)

    const year = parts.find((part) => part.type === 'year')?.value ?? '1970'
    const month = parts.find((part) => part.type === 'month')?.value ?? '01'
    const day = parts.find((part) => part.type === 'day')?.value ?? '01'
    return `${year}-${month}-${day}`
}

const shiftMonths = (dateStr: string, months: number, timezone: string): string => {
    const { year, month, day } = parseDateParts(dateStr)
    const shifted = new Date(Date.UTC(year, month - 1 + months, day))
    return `${shifted.getUTCFullYear()}-${padMonth(shifted.getUTCMonth() + 1)}-${padDay(shifted.getUTCDate())}`
}

const parseDateParts = (dateStr: string): { year: number; month: number; day: number } => {
    const [year, month, day] = dateStr.split('-').map(Number)
    return { year, month, day }
}

export const getDefaultDashboardRange = (
    timezone: string
): { periodStart: Date; periodEnd: Date; startDate: string; endDate: string } => {
    const endDate = formatDateOnlyInTimezone(new Date(), timezone)
    const startDate = shiftMonths(endDate, -5, timezone)

    const { start: periodStart, end: periodEnd } = resolveDateRange(startDate, endDate, timezone)
    return { periodStart, periodEnd, startDate, endDate }
}

export const parseDashboardDateRange = (
    startDate: string | undefined,
    endDate: string | undefined,
    timezone: string
): { periodStart: Date; periodEnd: Date; startDate: string; endDate: string } => {
    if (!startDate || !endDate) {
        return getDefaultDashboardRange(timezone)
    }

    try {
        const { start: periodStart, end: periodEnd } = resolveDateRange(startDate, endDate, timezone)
        return { periodStart, periodEnd, startDate, endDate }
    } catch {
        throw new CustomError(
            'Invalid date range; use YYYY-MM-DD dates with start on or before end',
            400
        )
    }
}

export const parseDashboardGroupBy = (value: unknown): DashboardGroupBy => {
    const groupBy = typeof value === 'string' && value.trim() !== '' ? value : 'month'
    if (!DASHBOARD_GROUP_BY_VALUES.includes(groupBy as DashboardGroupBy)) {
        throw new CustomError(
            `Invalid groupBy. Must be one of: ${DASHBOARD_GROUP_BY_VALUES.join(', ')}`,
            400
        )
    }
    return groupBy as DashboardGroupBy
}

const getDateFormatForGroupBy = (groupBy: DashboardGroupBy): string => {
    if (groupBy === 'day') {
        return '%Y-%m-%d'
    }
    if (groupBy === 'week') {
        return '%G-W%V'
    }
    return '%Y-%m'
}

const buildPeriodKey = (dateStr: string, groupBy: DashboardGroupBy): string => {
    if (groupBy === 'month') {
        return dateStr.slice(0, 7)
    }
    if (groupBy === 'week') {
        const date = new Date(`${dateStr}T12:00:00.000Z`)
        const day = date.getUTCDay() || 7
        date.setUTCDate(date.getUTCDate() + 4 - day)
        const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
        const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
        return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
    }
    return dateStr
}

const roundMoney = (amount: number): number =>
    Math.round((amount + Number.EPSILON) * 100) / 100

const countPostedTransactionsByType = async (
    userId: string,
    type: 'income' | 'expense',
    periodStart: Date,
    periodEnd: Date,
    workspaceId?: string | null
): Promise<number> => {
    const scope = buildScopedListFilter(userId, workspaceId ?? null)

    const splitParentIds = await Transaction.distinct('splitTransactionId', {
        ...scope,
        splitTransactionId: { $ne: null },
    })

    return Transaction.countDocuments({
        ...scope,
        type,
        status: 'posted',
        date: { $gte: periodStart, $lte: periodEnd },
        $or: [
            { splitTransactionId: { $ne: null } },
            { splitTransactionId: null, _id: { $nin: splitParentIds } },
        ],
    })
}

const enumeratePeriods = (
    startDate: string,
    endDate: string,
    groupBy: DashboardGroupBy
): string[] => {
    const periods: string[] = []
    const seen = new Set<string>()

    if (groupBy === 'month') {
        const { year: startYear, month: startMonth } = parseDateParts(startDate)
        const { year: endYear, month: endMonth } = parseDateParts(endDate)
        let year = startYear
        let month = startMonth

        while (year < endYear || (year === endYear && month <= endMonth)) {
            const key = `${year}-${padMonth(month)}`
            if (!seen.has(key)) {
                seen.add(key)
                periods.push(key)
            }
            month += 1
            if (month > 12) {
                month = 1
                year += 1
            }
        }
        return periods
    }

    const cursor = new Date(`${startDate}T12:00:00.000Z`)
    const end = new Date(`${endDate}T12:00:00.000Z`)

    while (cursor <= end) {
        const dateStr = cursor.toISOString().slice(0, 10)
        const key = buildPeriodKey(dateStr, groupBy)
        if (!seen.has(key)) {
            seen.add(key)
            periods.push(key)
        }
        cursor.setUTCDate(cursor.getUTCDate() + (groupBy === 'week' ? 7 : 1))
    }

    return periods
}

const countMonthsInRange = (startDate: string, endDate: string): number =>
    Math.max(1, enumeratePeriods(startDate, endDate, 'month').length)

export const sumPostedTransactionsByType = async (
    userId: string,
    type: 'income' | 'expense',
    periodStart: Date,
    periodEnd: Date,
    workspaceId?: string | null
): Promise<number> => {
    const scope = buildScopedListFilter(userId, workspaceId ?? null)
    const result = await Transaction.aggregate([
        {
            $match: {
                ...scope,
                type,
                date: { $gte: periodStart, $lte: periodEnd },
                ...POSTED_LEDGER_FILTER,
            },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
    ])

    return result[0]?.total ?? 0
}

export const computeDashboardSummary = async (
    userId: string,
    periodStart: Date,
    periodEnd: Date,
    startDate: string,
    endDate: string,
    workspaceId?: string | null
): Promise<DashboardSummary> => {
    const [balances, incomeMinor, expenseMinor] = await Promise.all([
        computeUserBalances(userId, workspaceId),
        sumPostedTransactionsByType(userId, 'income', periodStart, periodEnd, workspaceId),
        sumPostedTransactionsByType(userId, 'expense', periodStart, periodEnd, workspaceId),
    ])

    const [incomeTransactionCount, expenseTransactionCount] = await Promise.all([
        countPostedTransactionsByType(userId, 'income', periodStart, periodEnd, workspaceId),
        countPostedTransactionsByType(userId, 'expense', periodStart, periodEnd, workspaceId),
    ])

    const totalIncome = fromMinorUnits(incomeMinor)
    const totalExpenses = fromMinorUnits(expenseMinor)
    const netSavings = roundMoney(totalIncome - totalExpenses)
    const monthCount = countMonthsInRange(startDate, endDate)

    return {
        netWorth: balances.netWorth,
        totalAccountBalance: balances.totalAccountBalance,
        accountCount: balances.accountCount,
        balanceSource: balances.balanceSource,
        spendableBalance: balances.spendableBalance,
        saverBalance: balances.saverBalance,
        netSavings,
        totalIncome,
        totalExpenses,
        averageIncomePerMonth: roundMoney(totalIncome / monthCount),
        averageExpensePerMonth: roundMoney(totalExpenses / monthCount),
        averageIncomePerTransaction:
            incomeTransactionCount > 0 ? roundMoney(totalIncome / incomeTransactionCount) : 0,
        averageExpensePerTransaction:
            expenseTransactionCount > 0 ? roundMoney(totalExpenses / expenseTransactionCount) : 0,
        incomeTransactionCount,
        expenseTransactionCount,
        monthCount,
        periodStart: startDate,
        periodEnd: endDate,
    }
}

export const computeNetWorthTrend = async (
    userId: string,
    periodStart: Date,
    periodEnd: Date,
    startDate: string,
    endDate: string,
    timezone: string,
    workspaceId?: string | null
): Promise<NetWorthTrendResponse> => {
    const [balances, cashFlow] = await Promise.all([
        computeUserBalances(userId, workspaceId),
        computeCashFlowSeries(
            userId,
            periodStart,
            periodEnd,
            startDate,
            endDate,
            'month',
            timezone,
            workspaceId
        ),
    ])

    const cumulativeIncome: number[] = []
    const cumulativeExpense: number[] = []
    let runningIncome = 0
    let runningExpense = 0

    for (const point of cashFlow) {
        runningIncome = roundMoney(runningIncome + point.income)
        runningExpense = roundMoney(runningExpense + point.expense)
        cumulativeIncome.push(runningIncome)
        cumulativeExpense.push(runningExpense)
    }

    const series: NetWorthPoint[] = []

    if (balances.balanceSource === 'accounts') {
        let netWorthCursor = balances.netWorth
        for (let index = cashFlow.length - 1; index >= 0; index -= 1) {
            series.unshift({
                period: cashFlow[index].period,
                netWorth: netWorthCursor,
                cumulativeIncome: cumulativeIncome[index],
                cumulativeExpense: cumulativeExpense[index],
            })
            if (index > 0) {
                netWorthCursor = roundMoney(netWorthCursor - cashFlow[index].net)
            }
        }
    } else {
        let cumulativeNet = 0
        for (let index = 0; index < cashFlow.length; index += 1) {
            cumulativeNet = roundMoney(cumulativeNet + cashFlow[index].net)
            series.push({
                period: cashFlow[index].period,
                netWorth: cumulativeNet,
                cumulativeIncome: cumulativeIncome[index],
                cumulativeExpense: cumulativeExpense[index],
            })
        }
    }

    const accountTotals = await computeAccountTotals(userId, workspaceId)
    const accounts = await Account.find({
        ...buildScopedListFilter(userId, workspaceId ?? null),
        isArchived: false,
    })

    let savings = 0
    let credit = 0

    for (const account of accounts) {
        const balance = roundMoney(account.currentBalance)
        if (account.type === 'credit') {
            credit = roundMoney(credit + balance)
        } else if (account.type === 'savings') {
            savings = roundMoney(savings + balance)
        }
    }

    return {
        series,
        currentBalances: {
            liquid: balances.balanceSource === 'accounts' ? accountTotals.liquidBalance : 0,
            savings,
            credit,
            saver: balances.saverBalance,
            spendable: balances.spendableBalance,
            netWorth: balances.netWorth,
        },
        balanceSource: balances.balanceSource,
        periodStart: startDate,
        periodEnd: endDate,
    }
}

export const computeBudgetOverview = async (
    userId: string,
    timezone: string,
    workspaceId?: string | null
): Promise<BudgetOverviewResponse> => {
    const now = formatDateOnlyInTimezone(new Date(), timezone)
    const { year, month } = parseDateParts(now)
    const { periodStart, periodEnd } = resolveMonthlyPeriod(year, month, timezone)
    const startDate = `${year}-${padMonth(month)}-01`
    const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const endDate = `${year}-${padMonth(month)}-${String(endDay).padStart(2, '0')}`

    const budgets = await Budget.find({
        ...buildScopedListFilter(userId, workspaceId ?? null),
        isArchived: false,
        periodStart: { $lte: periodEnd },
        periodEnd: { $gte: periodStart },
    }).sort({ periodStart: -1 })

    const withProgress = await attachProgressToBudgets(budgets)
    const categoryIds = withProgress
        .map((budget) => budget.categoryId?.toString())
        .filter((id): id is string => Boolean(id))

    const categories =
        categoryIds.length > 0
            ? await Category.find({ _id: { $in: categoryIds } })
            : []
    const categoryMap = new Map(categories.map((category) => [category._id.toString(), category.name]))

    return {
        periodStart: startDate,
        periodEnd: endDate,
        budgets: withProgress.map((budget) => serializeBudgetOverview(budget, categoryMap)),
    }
}

const serializeBudgetOverview = (
    budget: SerializedBudget,
    categoryMap: Map<string, string>
): BudgetOverviewItem => ({
    budgetId: budget._id.toString(),
    name: budget.name,
    categoryName: budget.categoryId ? categoryMap.get(budget.categoryId.toString()) : undefined,
    budgetAmount: budget.progress?.budgetAmount ?? fromMinorUnits(budget.amount),
    spent: budget.progress?.spent ?? 0,
    remaining: budget.progress?.remaining ?? 0,
    percentUsed: budget.progress?.percentUsed ?? 0,
    isOverBudget: budget.progress?.isOverBudget ?? false,
})

export const computePaymentMethodBreakdown = async (
    userId: string,
    periodStart: Date,
    periodEnd: Date,
    workspaceId?: string | null
): Promise<PaymentMethodBreakdownItem[]> => {
    const scope = buildScopedListFilter(userId, workspaceId ?? null)

    const splitParentIds = await Transaction.distinct('splitTransactionId', {
        ...scope,
        splitTransactionId: { $ne: null },
    })

    const rows = await Transaction.aggregate([
        {
            $match: {
                ...scope,
                type: 'expense',
                status: 'posted',
                date: { $gte: periodStart, $lte: periodEnd },
                $or: [
                    { splitTransactionId: { $ne: null } },
                    { splitTransactionId: null, _id: { $nin: splitParentIds } },
                ],
            },
        },
        {
            $group: {
                _id: { $ifNull: ['$paymentMethod', 'Unspecified'] },
                totalAmount: { $sum: '$amount' },
            },
        },
        { $sort: { totalAmount: -1 } },
    ])

    return rows.map((row) => ({
        paymentMethod: row._id as string,
        amount: fromMinorUnits(row.totalAmount as number),
    }))
}

export const computeCashFlowSeries = async (
    userId: string,
    periodStart: Date,
    periodEnd: Date,
    startDate: string,
    endDate: string,
    groupBy: DashboardGroupBy,
    timezone: string,
    workspaceId?: string | null
): Promise<CashFlowPoint[]> => {
    const scope = buildScopedListFilter(userId, workspaceId ?? null)
    const dateFormat = getDateFormatForGroupBy(groupBy)

    const rows = await Transaction.aggregate([
        {
            $match: {
                ...scope,
                type: { $in: ['income', 'expense'] },
                date: { $gte: periodStart, $lte: periodEnd },
                ...POSTED_LEDGER_FILTER,
            },
        },
        {
            $group: {
                _id: {
                    period: {
                        $dateToString: {
                            format: dateFormat,
                            date: '$date',
                            timezone,
                        },
                    },
                    type: '$type',
                },
                total: { $sum: '$amount' },
            },
        },
    ])

    const incomeByPeriod = new Map<string, number>()
    const expenseByPeriod = new Map<string, number>()

    for (const row of rows) {
        const period = row._id.period as string
        const amount = fromMinorUnits(row.total as number)
        if (row._id.type === 'income') {
            incomeByPeriod.set(period, amount)
        } else {
            expenseByPeriod.set(period, amount)
        }
    }

    const periods = enumeratePeriods(startDate, endDate, groupBy)

    return periods.map((period) => {
        const income = incomeByPeriod.get(period) ?? 0
        const expense = expenseByPeriod.get(period) ?? 0
        const net = Math.round((income - expense + Number.EPSILON) * 100) / 100
        return { period, income, expense, net }
    })
}

export const computeCategoryBreakdown = async (
    userId: string,
    periodStart: Date,
    periodEnd: Date,
    type: 'expense' | 'income',
    workspaceId?: string | null
): Promise<CategoryBreakdownItem[]> => {
    const scope = buildScopedListFilter(userId, workspaceId ?? null)

    const splitParentIds = await Transaction.distinct('splitTransactionId', {
        ...scope,
        splitTransactionId: { $ne: null },
    })

    const rows = await Transaction.aggregate([
        {
            $match: {
                ...scope,
                type,
                status: 'posted',
                date: { $gte: periodStart, $lte: periodEnd },
                $or: [
                    { splitTransactionId: { $ne: null } },
                    {
                        splitTransactionId: null,
                        _id: { $nin: splitParentIds },
                    },
                ],
            },
        },
        {
            $group: {
                _id: '$categoryId',
                totalAmount: { $sum: '$amount' },
            },
        },
        { $sort: { totalAmount: -1 } },
    ])

    if (rows.length === 0) {
        return []
    }

    const categoryIds = rows.map((row) => row._id as Types.ObjectId)
    const categories = await Category.find({ _id: { $in: categoryIds } })
    const categoryMap = new Map(categories.map((category) => [category._id.toString(), category]))

    return rows.map((row) => {
        const categoryId = (row._id as Types.ObjectId).toString()
        const category = categoryMap.get(categoryId)
        return {
            categoryId,
            categoryName: category?.name ?? 'Unknown',
            amount: fromMinorUnits(row.totalAmount as number),
            color: category?.color,
        }
    })
}

export const resolveDashboardQuery = (
    query: Record<string, unknown>,
    timezone?: string
): {
    periodStart: Date
    periodEnd: Date
    startDate: string
    endDate: string
    groupBy: DashboardGroupBy
    timezone: string
} => {
    const resolvedTimezone = timezone?.trim() || DEFAULT_TIMEZONE
    const groupBy = parseDashboardGroupBy(query.groupBy)
    const { periodStart, periodEnd, startDate, endDate } = parseDashboardDateRange(
        typeof query.startDate === 'string' ? query.startDate : undefined,
        typeof query.endDate === 'string' ? query.endDate : undefined,
        resolvedTimezone
    )

    return {
        periodStart,
        periodEnd,
        startDate,
        endDate,
        groupBy,
        timezone: resolvedTimezone,
    }
}
