import { Types } from 'mongoose'

import Category from '../models/Category'
import Budget from '../models/Budget'
import RecurringRule, { IRecurringRule, RecurringInterval } from '../models/RecurringRule'
import Transaction from '../models/Transaction'
import { resolveMonthlyPeriod, attachProgressToBudgets } from './budgetUtils'
import {
    computeCashFlowSeries,
    computeCategoryBreakdown,
    computeDashboardSummary,
    computePaymentMethodBreakdown,
    parseDashboardDateRange,
    sumPostedTransactionsByType,
    type DashboardGroupBy,
} from './dashboardUtils'
import { buildCsvString } from './transactionUtils'
import { CustomError } from './customError'
import { fromMinorUnits } from './moneyUtils'
import {
    DEFAULT_TIMEZONE,
    resolveDateRange,
} from './timezoneUtils'
import { toObjectId } from './sharedUtils'

export const REPORT_PERIOD_TYPES = ['monthly', 'yearly', 'custom'] as const
export type ReportPeriodType = (typeof REPORT_PERIOD_TYPES)[number]

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

export const CUSTOM_REPORT_SPLIT_BY = ['total', 'time', 'category', 'paymentMethod'] as const
export type CustomReportSplitBy = (typeof CUSTOM_REPORT_SPLIT_BY)[number]

export const CUSTOM_REPORT_CHART_TYPES = ['table', 'bar', 'line', 'area', 'donut'] as const
export type CustomReportChartType = (typeof CUSTOM_REPORT_CHART_TYPES)[number]

export const CUSTOM_REPORT_DATA_TYPES = ['income', 'expense', 'both'] as const
export type CustomReportDataType = (typeof CUSTOM_REPORT_DATA_TYPES)[number]

export interface ReportPeriod {
    periodType: ReportPeriodType
    periodStart: Date
    periodEnd: Date
    startDate: string
    endDate: string
}

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

export interface CustomReportQueryRow {
    label: string
    income: number
    expense: number
    total: number
}

export interface CustomReportQueryResult {
    chartType: CustomReportChartType
    splitBy: CustomReportSplitBy
    dataType: CustomReportDataType
    groupBy?: DashboardGroupBy
    periodStart: string
    periodEnd: string
    rows: CustomReportQueryRow[]
}

const roundMoney = (amount: number): number =>
    Math.round((amount + Number.EPSILON) * 100) / 100

const padMonth = (month: number): string => String(month).padStart(2, '0')

const daysInclusive = (startDate: string, endDate: string): number => {
    const start = new Date(`${startDate}T12:00:00.000Z`)
    const end = new Date(`${endDate}T12:00:00.000Z`)
    return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
}

export const parseReportPeriodType = (value: unknown): ReportPeriodType => {
    if (typeof value !== 'string' || !REPORT_PERIOD_TYPES.includes(value as ReportPeriodType)) {
        throw new CustomError(
            `Invalid periodType. Must be one of: ${REPORT_PERIOD_TYPES.join(', ')}`,
            400
        )
    }
    return value as ReportPeriodType
}

export const resolveReportPeriod = (
    query: Record<string, unknown>,
    timezone?: string
): ReportPeriod => {
    const resolvedTimezone = timezone?.trim() || DEFAULT_TIMEZONE
    const periodType = parseReportPeriodType(query.periodType ?? 'custom')

    if (periodType === 'monthly') {
        const year = Number(query.year)
        const month = Number(query.month)
        if (!Number.isInteger(year) || !Number.isInteger(month)) {
            throw new CustomError('Monthly reports require year and month query params', 400)
        }
        const { periodStart, periodEnd } = resolveMonthlyPeriod(year, month, resolvedTimezone)
        const startDate = `${year}-${padMonth(month)}-01`
        const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
        const endDate = `${year}-${padMonth(month)}-${String(endDay).padStart(2, '0')}`
        return { periodType, periodStart, periodEnd, startDate, endDate }
    }

    if (periodType === 'yearly') {
        const year = Number(query.year)
        if (!Number.isInteger(year)) {
            throw new CustomError('Yearly reports require year query param', 400)
        }
        const startDate = `${year}-01-01`
        const endDate = `${year}-12-31`
        const { start: periodStart, end: periodEnd } = resolveDateRange(
            startDate,
            endDate,
            resolvedTimezone
        )
        return { periodType, periodStart, periodEnd, startDate, endDate }
    }

    const { periodStart, periodEnd, startDate, endDate } = parseDashboardDateRange(
        typeof query.startDate === 'string' ? query.startDate : undefined,
        typeof query.endDate === 'string' ? query.endDate : undefined,
        resolvedTimezone
    )
    return { periodType, periodStart, periodEnd, startDate, endDate }
}

export const computePeriodAverages = async (
    userId: string,
    period: ReportPeriod,
    timezone: string
): Promise<PeriodAverages> => {
    const [incomeMinor, expenseMinor] = await Promise.all([
        sumPostedTransactionsByType(userId, 'income', period.periodStart, period.periodEnd),
        sumPostedTransactionsByType(userId, 'expense', period.periodStart, period.periodEnd),
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
            timezone
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
    limit = 10
): Promise<LargestExpenseItem[]> => {
    const objectId = toObjectId(userId)
    const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), 50)

    const splitParentIds = await Transaction.distinct('splitTransactionId', {
        userId: objectId,
        splitTransactionId: { $ne: null },
    })

    const transactions = await Transaction.find({
        userId: objectId,
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
    const categories = await Category.find({ _id: { $in: categoryIds } })
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
    timezone: string
): Promise<SpendingTrendPoint[]> => {
    const series = await computeCashFlowSeries(
        userId,
        period.periodStart,
        period.periodEnd,
        period.startDate,
        period.endDate,
        'month',
        timezone
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
    period: ReportPeriod
): Promise<IncomeVsExpenseComparison> => {
    const [incomeMinor, expenseMinor] = await Promise.all([
        sumPostedTransactionsByType(userId, 'income', period.periodStart, period.periodEnd),
        sumPostedTransactionsByType(userId, 'expense', period.periodStart, period.periodEnd),
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
    period: ReportPeriod
): Promise<SavingsRateReport> => {
    const [incomeMinor, expenseMinor] = await Promise.all([
        sumPostedTransactionsByType(userId, 'income', period.periodStart, period.periodEnd),
        sumPostedTransactionsByType(userId, 'expense', period.periodStart, period.periodEnd),
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
    period: ReportPeriod
): Promise<RecurringTotalsReport> => {
    const objectId = toObjectId(userId)

    const [rules, recurringExpenseAgg] = await Promise.all([
        RecurringRule.find({
            userId: objectId,
            type: 'expense',
            isActive: true,
            isArchived: false,
        }),
        Transaction.aggregate([
            {
                $match: {
                    userId: objectId,
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
    largestExpensesLimit = 10
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
                    period.endDate
                )
                break
            case 'averages':
                result.metrics.averages = await computePeriodAverages(userId, period, timezone)
                break
            case 'largestExpenses':
                result.metrics.largestExpenses = await computeLargestExpenses(
                    userId,
                    period.periodStart,
                    period.periodEnd,
                    largestExpensesLimit
                )
                break
            case 'spendingTrends':
                result.metrics.spendingTrends = await computeSpendingTrends(
                    userId,
                    period,
                    timezone
                )
                break
            case 'incomeVsExpense':
                result.metrics.incomeVsExpense = await computeIncomeVsExpense(userId, period)
                break
            case 'savingsRate':
                result.metrics.savingsRate = await computeSavingsRate(userId, period)
                break
            case 'recurringTotals':
                result.metrics.recurringTotals = await computeRecurringTotals(userId, period)
                break
            case 'categoryBreakdown':
                result.metrics.categoryBreakdown = await computeCategoryBreakdown(
                    userId,
                    period.periodStart,
                    period.periodEnd,
                    'expense'
                )
                break
            case 'budgetAnalysis':
                result.metrics.budgetAnalysis = await computeBudgetAnalysis(userId, period, timezone)
                break
            case 'spendingAnalysis':
                result.metrics.spendingAnalysis = await computeSpendingAnalysis(
                    userId,
                    period,
                    timezone,
                    largestExpensesLimit
                )
                break
            case 'crossoverPoint':
                result.metrics.crossoverPoint = await computeCrossoverPoint(userId, period, timezone)
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
    timezone: string
): Promise<BudgetAnalysisReport> => {
    const budgets = await Budget.find({
        userId: toObjectId(userId),
        isArchived: false,
        periodStart: { $lte: period.periodEnd },
        periodEnd: { $gte: period.periodStart },
    }).sort({ periodStart: -1 })

    const withProgress = await attachProgressToBudgets(budgets)
    const categoryIds = withProgress
        .map((budget) => budget.categoryId?.toString())
        .filter((id): id is string => Boolean(id))

    const categories =
        categoryIds.length > 0 ? await Category.find({ _id: { $in: categoryIds } }) : []
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
    largestLimit = 10
): Promise<SpendingAnalysisReport> => {
    const objectId = toObjectId(userId)

    const splitParentIds = await Transaction.distinct('splitTransactionId', {
        userId: objectId,
        splitTransactionId: { $ne: null },
    })

    const transactionCount = await Transaction.countDocuments({
        userId: objectId,
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
        period.periodEnd
    )
    const totalExpenses = fromMinorUnits(expenseMinor)

    const [topCategories, topPaymentMethods, largestExpenses, trends] = await Promise.all([
        computeCategoryBreakdown(userId, period.periodStart, period.periodEnd, 'expense'),
        computePaymentMethodBreakdown(userId, period.periodStart, period.periodEnd),
        computeLargestExpenses(userId, period.periodStart, period.periodEnd, largestLimit),
        computeSpendingTrends(userId, period, timezone),
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
    timezone: string
): Promise<CrossoverPointReport> => {
    const cashFlow = await computeCashFlowSeries(
        userId,
        period.periodStart,
        period.periodEnd,
        period.startDate,
        period.endDate,
        'month',
        timezone
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

export const parseCustomReportSplitBy = (value: unknown): CustomReportSplitBy => {
    if (
        typeof value !== 'string' ||
        !CUSTOM_REPORT_SPLIT_BY.includes(value as CustomReportSplitBy)
    ) {
        throw new CustomError(
            `Invalid splitBy. Must be one of: ${CUSTOM_REPORT_SPLIT_BY.join(', ')}`,
            400
        )
    }
    return value as CustomReportSplitBy
}

export const parseCustomReportChartType = (value: unknown): CustomReportChartType => {
    if (
        typeof value !== 'string' ||
        !CUSTOM_REPORT_CHART_TYPES.includes(value as CustomReportChartType)
    ) {
        throw new CustomError(
            `Invalid chartType. Must be one of: ${CUSTOM_REPORT_CHART_TYPES.join(', ')}`,
            400
        )
    }
    return value as CustomReportChartType
}

export const parseCustomReportDataType = (value: unknown): CustomReportDataType => {
    const dataType = typeof value === 'string' ? value : 'expense'
    if (!CUSTOM_REPORT_DATA_TYPES.includes(dataType as CustomReportDataType)) {
        throw new CustomError(
            `Invalid dataType. Must be one of: ${CUSTOM_REPORT_DATA_TYPES.join(', ')}`,
            400
        )
    }
    return dataType as CustomReportDataType
}

export const executeCustomReportQuery = async (
    userId: string,
    period: ReportPeriod,
    options: {
        splitBy: CustomReportSplitBy
        chartType: CustomReportChartType
        dataType: CustomReportDataType
        groupBy: DashboardGroupBy
        timezone: string
    }
): Promise<CustomReportQueryResult> => {
    const { splitBy, chartType, dataType, groupBy, timezone } = options
    let rows: CustomReportQueryRow[] = []

    if (splitBy === 'total') {
        const [incomeMinor, expenseMinor] = await Promise.all([
            sumPostedTransactionsByType(userId, 'income', period.periodStart, period.periodEnd),
            sumPostedTransactionsByType(userId, 'expense', period.periodStart, period.periodEnd),
        ])
        const income = fromMinorUnits(incomeMinor)
        const expense = fromMinorUnits(expenseMinor)
        rows = [{ label: 'Total', income, expense, total: roundMoney(income + expense) }]
    } else if (splitBy === 'time') {
        const series = await computeCashFlowSeries(
            userId,
            period.periodStart,
            period.periodEnd,
            period.startDate,
            period.endDate,
            groupBy,
            timezone
        )
        rows = series.map((point) => ({
            label: point.period,
            income: point.income,
            expense: point.expense,
            total: roundMoney(point.income + point.expense),
        }))
    } else if (splitBy === 'category') {
        if (dataType === 'both') {
            const [incomeBreakdown, expenseBreakdown] = await Promise.all([
                computeCategoryBreakdown(userId, period.periodStart, period.periodEnd, 'income'),
                computeCategoryBreakdown(userId, period.periodStart, period.periodEnd, 'expense'),
            ])
            const labels = new Set([
                ...incomeBreakdown.map((item) => item.categoryName),
                ...expenseBreakdown.map((item) => item.categoryName),
            ])
            rows = [...labels].map((label) => {
                const income =
                    incomeBreakdown.find((item) => item.categoryName === label)?.amount ?? 0
                const expense =
                    expenseBreakdown.find((item) => item.categoryName === label)?.amount ?? 0
                return { label, income, expense, total: roundMoney(income + expense) }
            })
            rows.sort((a, b) => b.total - a.total)
        } else {
            const type = dataType === 'income' ? 'income' : 'expense'
            const breakdown = await computeCategoryBreakdown(
                userId,
                period.periodStart,
                period.periodEnd,
                type
            )
            rows = breakdown.map((item) => ({
                label: item.categoryName,
                income: type === 'income' ? item.amount : 0,
                expense: type === 'expense' ? item.amount : 0,
                total: item.amount,
            }))
        }
    } else {
        const paymentMethods = await computePaymentMethodBreakdown(
            userId,
            period.periodStart,
            period.periodEnd
        )
        rows = paymentMethods.map((item) => ({
            label: item.paymentMethod,
            income: 0,
            expense: item.amount,
            total: item.amount,
        }))
    }

    return {
        chartType,
        splitBy,
        dataType,
        groupBy: splitBy === 'time' ? groupBy : undefined,
        periodStart: period.startDate,
        periodEnd: period.endDate,
        rows,
    }
}

export interface FlatReportRow {
    section: string
    key: string
    value: string
}

export const flattenCustomReport = (report: CustomReportResult): FlatReportRow[] => {
    const rows: FlatReportRow[] = []

    rows.push({ section: 'Meta', key: 'Period Type', value: report.periodType })
    rows.push({ section: 'Meta', key: 'Period Start', value: report.periodStart })
    rows.push({ section: 'Meta', key: 'Period End', value: report.periodEnd })

    const pushRow = (section: string, key: string, value: string | number) => {
        rows.push({ section, key, value: String(value) })
    }

    if (report.metrics.summary) {
        const summary = report.metrics.summary as Awaited<ReturnType<typeof computeDashboardSummary>>
        pushRow('Summary', 'Net Worth', summary.netWorth)
        pushRow('Summary', 'Net Savings', summary.netSavings)
        pushRow('Summary', 'Total Income', summary.totalIncome)
        pushRow('Summary', 'Total Expenses', summary.totalExpenses)
    }

    if (report.metrics.averages) {
        const averages = report.metrics.averages as PeriodAverages
        pushRow('Averages', 'Average Income', averages.averageIncome)
        pushRow('Averages', 'Average Expenses', averages.averageExpenses)
        pushRow('Averages', 'Average Net Savings', averages.averageNetSavings)
        pushRow('Averages', 'Unit', averages.unit)
    }

    if (report.metrics.savingsRate) {
        const savingsRate = report.metrics.savingsRate as SavingsRateReport
        pushRow('Savings Rate', 'Rate (%)', savingsRate.savingsRate)
        pushRow('Savings Rate', 'Net Savings', savingsRate.netSavings)
    }

    if (report.metrics.incomeVsExpense) {
        const comparison = report.metrics.incomeVsExpense as IncomeVsExpenseComparison
        pushRow('Income vs Expense', 'Total Income', comparison.totalIncome)
        pushRow('Income vs Expense', 'Total Expenses', comparison.totalExpenses)
        pushRow('Income vs Expense', 'Expense/Income Ratio', comparison.expenseToIncomeRatio)
    }

    if (report.metrics.recurringTotals) {
        const recurring = report.metrics.recurringTotals as RecurringTotalsReport
        pushRow('Recurring', 'Monthly Equivalent Total', recurring.totalMonthlyEquivalent)
        pushRow(
            'Recurring',
            'Posted Recurring Expenses',
            recurring.postedRecurringExpensesInPeriod
        )
    }

    if (report.metrics.largestExpenses) {
        const largest = report.metrics.largestExpenses as LargestExpenseItem[]
        largest.forEach((item, index) => {
            pushRow('Largest Expenses', `#${index + 1} ${item.title}`, item.amount)
        })
    }

    if (report.metrics.categoryBreakdown) {
        const breakdown = report.metrics.categoryBreakdown as Awaited<
            ReturnType<typeof computeCategoryBreakdown>
        >
        breakdown.forEach((item) => {
            pushRow('Category Breakdown', item.categoryName, item.amount)
        })
    }

    if (report.metrics.spendingTrends) {
        const trends = report.metrics.spendingTrends as SpendingTrendPoint[]
        trends.forEach((point) => {
            pushRow(
                'Spending Trends',
                point.period,
                point.changePercent === null ? point.expense : `${point.expense} (${point.changePercent}%)`
            )
        })
    }

    return rows
}

export const customReportToCsv = (report: CustomReportResult): string => {
    const rows = [['Section', 'Key', 'Value'], ...flattenCustomReport(report).map((row) => [row.section, row.key, row.value])]
    return buildCsvString(rows)
}
