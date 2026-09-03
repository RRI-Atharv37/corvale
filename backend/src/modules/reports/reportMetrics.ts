import { Types } from 'mongoose'

import { Category } from '@modules/categories'
import { Budget } from '@modules/budgets'
import { IRecurringRule, RecurringInterval, RecurringRule } from '@modules/recurring'
import { Transaction } from '@modules/transactions'
import { CustomError } from '@core/errors/customError'
import { fromMinorUnits } from '@core/money/moneyUtils'
import { buildScopedListFilter } from '@core/access/workspace'
import { attachProgressToBudgets } from '@modules/budgets/budgetUtils'
import {
    computeCashFlowSeries,
    computeCategoryBreakdown,
    computeDashboardSummary,
    computePaymentMethodBreakdown,
    sumPostedTransactionsByType,
} from '@modules/dashboard/dashboardUtils'

import type { ReportPeriod, ReportPeriodType } from './reportPeriod'
import { roundMoney } from './reportMath'

export const REPORT_METRIC_KEYS = [
    'summary',
    'averages',
    'largestExpenses',
    'spendingTrends',
    'incomeVsExpense',
    'savingsRate',
    'recurringTotals',
    'categoryBreakdown',
    'budgetAnalysis',
    'spendingAnalysis',
    'crossoverPoint',
] as const
export type ReportMetricKey = (typeof REPORT_METRIC_KEYS)[number]

export interface PeriodAverages {
    periodType: ReportPeriodType
    periodStart: string
    periodEnd: string
    totalIncome: number
    totalExpenses: number
    netSavings: number
    unit: 'day' | 'month'
    unitCount: number
    averageIncome: number
    averageExpenses: number
    averageNetSavings: number
    monthlyBreakdown?: Array<{
        period: string
        income: number
        expense: number
        net: number
    }>
}

export interface LargestExpenseItem {
    transactionId: string
    title: string
    amount: number
    currency: string
    date: string
    categoryId: string
    categoryName: string
}

export interface SpendingTrendPoint {
    period: string
    expense: number
    changePercent: number | null
    trend: 'up' | 'down' | 'flat'
}

export interface IncomeVsExpenseComparison {
    totalIncome: number
    totalExpenses: number
    netSavings: number
    expenseToIncomeRatio: number
    incomeShare: number
    expenseShare: number
}

export interface SavingsRateReport {
    savingsRate: number
    totalIncome: number
    totalExpenses: number
    netSavings: number
    periodStart: string
    periodEnd: string
}

export interface RecurringExpenseRuleTotal {
    ruleId: string
    title: string
    amount: number
    currency: string
    interval: RecurringInterval
    monthlyEquivalent: number
}

export interface RecurringTotalsReport {
    activeExpenseRules: RecurringExpenseRuleTotal[]
    totalMonthlyEquivalent: number
    postedRecurringExpensesInPeriod: number
    periodStart: string
    periodEnd: string
}

export interface CustomReportResult {
    periodStart: string
    periodEnd: string
    periodType: ReportPeriodType
    metrics: Partial<Record<ReportMetricKey, unknown>>
}

export interface BudgetAnalysisItem {
    budgetId: string
    name?: string
    categoryName?: string
    budgetAmount: number
    spent: number
    remaining: number
    percentUsed: number
    isOverBudget: boolean
}

export interface BudgetAnalysisReport {
    periodStart: string
    periodEnd: string
    budgets: BudgetAnalysisItem[]
    totalBudgeted: number
    totalSpent: number
    overBudgetCount: number
    underBudgetCount: number
}

export interface SpendingAnalysisReport {
    periodStart: string
    periodEnd: string
    totalExpenses: number
    transactionCount: number
    averagePerTransaction: number
    topCategories: Awaited<ReturnType<typeof computeCategoryBreakdown>>
    topPaymentMethods: Awaited<ReturnType<typeof computePaymentMethodBreakdown>>
    largestExpenses: LargestExpenseItem[]
    trends: SpendingTrendPoint[]
}

export interface CrossoverPointReport {
    periodStart: string
    periodEnd: string
    hasCrossover: boolean
    crossoverPeriod: string | null
    monthlyCrossoverPeriod: string | null
    cumulativeIncomeAtCrossover: number | null
    cumulativeExpenseAtCrossover: number | null
    series: Array<{
        period: string
        cumulativeIncome: number
        cumulativeExpense: number
        gap: number
    }>
}

const daysInclusive = (startDate: string, endDate: string): number => {
    const start = new Date(`${startDate}T12:00:00.000Z`)
    const end = new Date(`${endDate}T12:00:00.000Z`)
    return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
}

export const computePeriodAverages = async (
    userId: string,
    period: ReportPeriod,
    timezone: string,
    workspaceId?: string | null
): Promise<PeriodAverages> => {
    const [incomeMinor, expenseMinor] = await Promise.all([
        sumPostedTransactionsByType(userId, 'income', period.periodStart, period.periodEnd, workspaceId),
        sumPostedTransactionsByType(userId, 'expense', period.periodStart, period.periodEnd, workspaceId),
    ])

    const totalIncome = fromMinorUnits(incomeMinor)
    const totalExpenses = fromMinorUnits(expenseMinor)
    const netSavings = roundMoney(totalIncome - totalExpenses)

    if (period.periodType === 'yearly') {
        const monthlyBreakdown = await computeCashFlowSeries(
            userId,
            period.periodStart,
            period.periodEnd,
            period.startDate,
            period.endDate,
            'month',
            timezone,
            workspaceId
        )

        const monthCount = Math.max(monthlyBreakdown.length, 1)
        return {
            periodType: period.periodType,
            periodStart: period.startDate,
            periodEnd: period.endDate,
            totalIncome,
            totalExpenses,
            netSavings,
            unit: 'month',
            unitCount: monthCount,
            averageIncome: roundMoney(totalIncome / monthCount),
            averageExpenses: roundMoney(totalExpenses / monthCount),
            averageNetSavings: roundMoney(netSavings / monthCount),
            monthlyBreakdown: monthlyBreakdown.map((point) => ({
                period: point.period,
                income: point.income,
                expense: point.expense,
                net: point.net,
            })),
        }
    }

    const unitCount = daysInclusive(period.startDate, period.endDate)
    return {
        periodType: period.periodType,
        periodStart: period.startDate,
        periodEnd: period.endDate,
        totalIncome,
        totalExpenses,
        netSavings,
        unit: 'day',
        unitCount,
        averageIncome: roundMoney(totalIncome / unitCount),
        averageExpenses: roundMoney(totalExpenses / unitCount),
        averageNetSavings: roundMoney(netSavings / unitCount),
    }
}

export const computeLargestExpenses = async (
    userId: string,
    periodStart: Date,
    periodEnd: Date,
    limit = 10,
    workspaceId?: string | null
): Promise<LargestExpenseItem[]> => {
    const scope = buildScopedListFilter(userId, workspaceId ?? null)
    const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), 50)

    const splitParentIds = await Transaction.distinct('splitTransactionId', {
        ...scope,
        splitTransactionId: { $ne: null },
    })

    const transactions = await Transaction.find({
        ...scope,
        type: 'expense',
        status: 'posted',
        date: { $gte: periodStart, $lte: periodEnd },
        $or: [
            { splitTransactionId: { $ne: null } },
            { splitTransactionId: null, _id: { $nin: splitParentIds } },
        ],
    })
        .sort({ amount: -1 })
        .limit(cappedLimit)
        .lean()

    if (transactions.length === 0) {
        return []
    }

    const categoryIds = [...new Set(transactions.map((tx) => tx.categoryId.toString()))]
    const categories = await Category.find({
        _id: { $in: categoryIds },
        userId: { $in: [new Types.ObjectId(userId), null] },
    })
    const categoryMap = new Map(categories.map((category) => [category._id.toString(), category]))

    return transactions.map((tx) => {
        const categoryId = tx.categoryId.toString()
        const category = categoryMap.get(categoryId)
        return {
            transactionId: tx._id.toString(),
            title: tx.title,
            amount: fromMinorUnits(tx.amount),
            currency: tx.currency,
            date: tx.date.toISOString(),
            categoryId,
            categoryName: category?.name ?? 'Unknown',
        }
    })
}

export const computeSpendingTrends = async (
    userId: string,
    period: ReportPeriod,
    timezone: string,
    workspaceId?: string | null
): Promise<SpendingTrendPoint[]> => {
    const series = await computeCashFlowSeries(
        userId,
        period.periodStart,
        period.periodEnd,
        period.startDate,
        period.endDate,
        'month',
        timezone,
        workspaceId
    )

    return series.map((point, index) => {
        const previous = index > 0 ? series[index - 1].expense : null
        const changePercent =
            previous !== null && previous > 0
                ? roundMoney(((point.expense - previous) / previous) * 100)
                : null

        return {
            period: point.period,
            expense: point.expense,
            changePercent,
            trend: resolveTrend(changePercent),
        }
    })
}

const resolveTrend = (changePercent: number | null): 'up' | 'down' | 'flat' => {
    if (changePercent === null || Math.abs(changePercent) < 1) {
        return 'flat'
    }
    return changePercent > 0 ? 'up' : 'down'
}

export const computeIncomeVsExpense = async (
    userId: string,
    period: ReportPeriod,
    workspaceId?: string | null
): Promise<IncomeVsExpenseComparison> => {
    const [incomeMinor, expenseMinor] = await Promise.all([
        sumPostedTransactionsByType(userId, 'income', period.periodStart, period.periodEnd, workspaceId),
        sumPostedTransactionsByType(userId, 'expense', period.periodStart, period.periodEnd, workspaceId),
    ])

    const totalIncome = fromMinorUnits(incomeMinor)
    const totalExpenses = fromMinorUnits(expenseMinor)
    const netSavings = roundMoney(totalIncome - totalExpenses)
    const combined = totalIncome + totalExpenses

    return {
        totalIncome,
        totalExpenses,
        netSavings,
        expenseToIncomeRatio: totalIncome > 0 ? roundMoney(totalExpenses / totalIncome) : 0,
        incomeShare: combined > 0 ? roundMoney(totalIncome / combined) : 0,
        expenseShare: combined > 0 ? roundMoney(totalExpenses / combined) : 0,
    }
}

export const computeSavingsRate = async (
    userId: string,
    period: ReportPeriod,
    workspaceId?: string | null
): Promise<SavingsRateReport> => {
    const [incomeMinor, expenseMinor] = await Promise.all([
        sumPostedTransactionsByType(userId, 'income', period.periodStart, period.periodEnd, workspaceId),
        sumPostedTransactionsByType(userId, 'expense', period.periodStart, period.periodEnd, workspaceId),
    ])

    const totalIncome = fromMinorUnits(incomeMinor)
    const totalExpenses = fromMinorUnits(expenseMinor)
    const netSavings = roundMoney(totalIncome - totalExpenses)
    const savingsRate =
        totalIncome > 0 ? roundMoney((netSavings / totalIncome) * 100) : 0

    return {
        savingsRate,
        totalIncome,
        totalExpenses,
        netSavings,
        periodStart: period.startDate,
        periodEnd: period.endDate,
    }
}

const monthlyEquivalentForRule = (rule: IRecurringRule): number => {
    const amount = fromMinorUnits(rule.amount)
    switch (rule.interval) {
        case 'daily':
            return roundMoney(amount * 30)
        case 'weekly':
            return roundMoney(amount * (52 / 12))
        case 'biweekly':
            return roundMoney(amount * (26 / 12))
        case 'monthly':
            return amount
        case 'quarterly':
            return roundMoney(amount / 3)
        case 'yearly':
            return roundMoney(amount / 12)
        case 'custom': {
            const days = rule.customIntervalDays ?? 30
            return roundMoney(amount * (30 / days))
        }
        default:
            return amount
    }
}

export const computeRecurringTotals = async (
    userId: string,
    period: ReportPeriod,
    workspaceId?: string | null
): Promise<RecurringTotalsReport> => {
    const scope = buildScopedListFilter(userId, workspaceId ?? null)

    const [rules, recurringExpenseAgg] = await Promise.all([
        RecurringRule.find({
            ...scope,
            type: 'expense',
            isActive: true,
            isArchived: false,
        }),
        Transaction.aggregate([
            {
                $match: {
                    ...scope,
                    type: 'expense',
                    status: 'posted',
                    recurringPaymentId: { $ne: null },
                    date: { $gte: period.periodStart, $lte: period.periodEnd },
                    splitTransactionId: null,
                },
            },
            { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
    ])

    const activeExpenseRules = rules.map((rule) => ({
        ruleId: rule._id.toString(),
        title: rule.title,
        amount: fromMinorUnits(rule.amount),
        currency: rule.currency,
        interval: rule.interval,
        monthlyEquivalent: monthlyEquivalentForRule(rule),
    }))

    const totalMonthlyEquivalent = roundMoney(
        activeExpenseRules.reduce((sum, rule) => sum + rule.monthlyEquivalent, 0)
    )

    return {
        activeExpenseRules,
        totalMonthlyEquivalent,
        postedRecurringExpensesInPeriod: fromMinorUnits(recurringExpenseAgg[0]?.total ?? 0),
        periodStart: period.startDate,
        periodEnd: period.endDate,
    }
}

export const parseReportMetrics = (value: unknown): ReportMetricKey[] => {
    let raw: string[] = []

    if (Array.isArray(value)) {
        raw = value.map(String)
    } else if (typeof value === 'string' && value.trim() !== '') {
        raw = value.split(',').map((item) => item.trim())
    } else {
        throw new CustomError(
            `metrics is required; must be one or more of: ${REPORT_METRIC_KEYS.join(', ')}`,
            400
        )
    }

    const invalid = raw.filter((key) => !REPORT_METRIC_KEYS.includes(key as ReportMetricKey))
    if (invalid.length > 0) {
        throw new CustomError(`Invalid metrics: ${invalid.join(', ')}`, 400)
    }

    const unique = [...new Set(raw)] as ReportMetricKey[]
    if (unique.length === 0) {
        throw new CustomError('At least one metric is required', 400)
    }

    return unique
}

export const generateCustomReport = async (
    userId: string,
    period: ReportPeriod,
    metrics: ReportMetricKey[],
    timezone: string,
    largestExpensesLimit = 10,
    workspaceId?: string | null
): Promise<CustomReportResult> => {
    const result: CustomReportResult = {
        periodStart: period.startDate,
        periodEnd: period.endDate,
        periodType: period.periodType,
        metrics: {},
    }

    for (const metric of metrics) {
        switch (metric) {
            case 'summary':
                result.metrics.summary = await computeDashboardSummary(
                    userId,
                    period.periodStart,
                    period.periodEnd,
                    period.startDate,
                    period.endDate,
                    workspaceId
                )
                break
            case 'averages':
                result.metrics.averages = await computePeriodAverages(userId, period, timezone, workspaceId)
                break
            case 'largestExpenses':
                result.metrics.largestExpenses = await computeLargestExpenses(
                    userId,
                    period.periodStart,
                    period.periodEnd,
                    largestExpensesLimit,
                    workspaceId
                )
                break
            case 'spendingTrends':
                result.metrics.spendingTrends = await computeSpendingTrends(
                    userId,
                    period,
                    timezone,
                    workspaceId
                )
                break
            case 'incomeVsExpense':
                result.metrics.incomeVsExpense = await computeIncomeVsExpense(userId, period, workspaceId)
                break
            case 'savingsRate':
                result.metrics.savingsRate = await computeSavingsRate(userId, period, workspaceId)
                break
            case 'recurringTotals':
                result.metrics.recurringTotals = await computeRecurringTotals(userId, period, workspaceId)
                break
            case 'categoryBreakdown':
                result.metrics.categoryBreakdown = await computeCategoryBreakdown(
                    userId,
                    period.periodStart,
                    period.periodEnd,
                    'expense',
                    workspaceId
                )
                break
            case 'budgetAnalysis':
                result.metrics.budgetAnalysis = await computeBudgetAnalysis(userId, period, timezone, workspaceId)
                break
            case 'spendingAnalysis':
                result.metrics.spendingAnalysis = await computeSpendingAnalysis(
                    userId,
                    period,
                    timezone,
                    largestExpensesLimit,
                    workspaceId
                )
                break
            case 'crossoverPoint':
                result.metrics.crossoverPoint = await computeCrossoverPoint(userId, period, timezone, workspaceId)
                break
            default:
                break
        }
    }

    return result
}

export const computeBudgetAnalysis = async (
    userId: string,
    period: ReportPeriod,
    timezone: string,
    workspaceId?: string | null
): Promise<BudgetAnalysisReport> => {
    const budgets = await Budget.find({
        ...buildScopedListFilter(userId, workspaceId ?? null),
        isArchived: false,
        periodStart: { $lte: period.periodEnd },
        periodEnd: { $gte: period.periodStart },
    }).sort({ periodStart: -1 })

    const withProgress = await attachProgressToBudgets(budgets)
    const categoryIds = withProgress
        .map((budget) => budget.categoryId?.toString())
        .filter((id): id is string => Boolean(id))

    const categories =
        categoryIds.length > 0
            ? await Category.find({
                  _id: { $in: categoryIds },
                  userId: { $in: [new Types.ObjectId(userId), null] },
              })
            : []
    const categoryMap = new Map(categories.map((category) => [category._id.toString(), category.name]))

    const items: BudgetAnalysisItem[] = withProgress.map((budget) => ({
        budgetId: budget._id.toString(),
        name: budget.name,
        categoryName: budget.categoryId ? categoryMap.get(budget.categoryId.toString()) : undefined,
        budgetAmount: budget.progress?.budgetAmount ?? fromMinorUnits(budget.amount),
        spent: budget.progress?.spent ?? 0,
        remaining: budget.progress?.remaining ?? 0,
        percentUsed: budget.progress?.percentUsed ?? 0,
        isOverBudget: budget.progress?.isOverBudget ?? false,
    }))

    const totalBudgeted = roundMoney(items.reduce((sum, item) => sum + item.budgetAmount, 0))
    const totalSpent = roundMoney(items.reduce((sum, item) => sum + item.spent, 0))

    return {
        periodStart: period.startDate,
        periodEnd: period.endDate,
        budgets: items,
        totalBudgeted,
        totalSpent,
        overBudgetCount: items.filter((item) => item.isOverBudget).length,
        underBudgetCount: items.filter((item) => !item.isOverBudget).length,
    }
}

export const computeSpendingAnalysis = async (
    userId: string,
    period: ReportPeriod,
    timezone: string,
    largestLimit = 10,
    workspaceId?: string | null
): Promise<SpendingAnalysisReport> => {
    const scope = buildScopedListFilter(userId, workspaceId ?? null)

    const splitParentIds = await Transaction.distinct('splitTransactionId', {
        ...scope,
        splitTransactionId: { $ne: null },
    })

    const transactionCount = await Transaction.countDocuments({
        ...scope,
        type: 'expense',
        status: 'posted',
        date: { $gte: period.periodStart, $lte: period.periodEnd },
        $or: [
            { splitTransactionId: { $ne: null } },
            { splitTransactionId: null, _id: { $nin: splitParentIds } },
        ],
    })

    const expenseMinor = await sumPostedTransactionsByType(
        userId,
        'expense',
        period.periodStart,
        period.periodEnd,
        workspaceId
    )
    const totalExpenses = fromMinorUnits(expenseMinor)

    const [topCategories, topPaymentMethods, largestExpenses, trends] = await Promise.all([
        computeCategoryBreakdown(userId, period.periodStart, period.periodEnd, 'expense', workspaceId),
        computePaymentMethodBreakdown(userId, period.periodStart, period.periodEnd, workspaceId),
        computeLargestExpenses(userId, period.periodStart, period.periodEnd, largestLimit, workspaceId),
        computeSpendingTrends(userId, period, timezone, workspaceId),
    ])

    return {
        periodStart: period.startDate,
        periodEnd: period.endDate,
        totalExpenses,
        transactionCount,
        averagePerTransaction:
            transactionCount > 0 ? roundMoney(totalExpenses / transactionCount) : 0,
        topCategories,
        topPaymentMethods,
        largestExpenses,
        trends,
    }
}

export const computeCrossoverPoint = async (
    userId: string,
    period: ReportPeriod,
    timezone: string,
    workspaceId?: string | null
): Promise<CrossoverPointReport> => {
    const cashFlow = await computeCashFlowSeries(
        userId,
        period.periodStart,
        period.periodEnd,
        period.startDate,
        period.endDate,
        'month',
        timezone,
        workspaceId
    )

    let cumulativeIncome = 0
    let cumulativeExpense = 0
    let crossoverPeriod: string | null = null
    let monthlyCrossoverPeriod: string | null = null
    let cumulativeIncomeAtCrossover: number | null = null
    let cumulativeExpenseAtCrossover: number | null = null

    const series = cashFlow.map((point) => {
        cumulativeIncome = roundMoney(cumulativeIncome + point.income)
        cumulativeExpense = roundMoney(cumulativeExpense + point.expense)

        if (
            crossoverPeriod === null &&
            cumulativeIncome >= cumulativeExpense &&
            cumulativeExpense > 0
        ) {
            crossoverPeriod = point.period
            cumulativeIncomeAtCrossover = cumulativeIncome
            cumulativeExpenseAtCrossover = cumulativeExpense
        }

        if (
            monthlyCrossoverPeriod === null &&
            point.income >= point.expense &&
            point.expense > 0
        ) {
            monthlyCrossoverPeriod = point.period
        }

        return {
            period: point.period,
            cumulativeIncome,
            cumulativeExpense,
            gap: roundMoney(cumulativeIncome - cumulativeExpense),
        }
    })

    return {
        periodStart: period.startDate,
        periodEnd: period.endDate,
        hasCrossover: crossoverPeriod !== null,
        crossoverPeriod,
        monthlyCrossoverPeriod,
        cumulativeIncomeAtCrossover,
        cumulativeExpenseAtCrossover,
        series,
    }
}
