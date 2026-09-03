import { CustomError } from '@core/errors/customError'
import { fromMinorUnits } from '@core/money/moneyUtils'
import {
    computeCashFlowSeries,
    computeCategoryBreakdown,
    computePaymentMethodBreakdown,
    sumPostedTransactionsByType,
    type DashboardGroupBy,
} from '@modules/dashboard/dashboardUtils'

import type { ReportPeriod } from './reportPeriod'
import { roundMoney } from './reportMath'

export const CUSTOM_REPORT_SPLIT_BY = ['total', 'time', 'category', 'paymentMethod'] as const
export type CustomReportSplitBy = (typeof CUSTOM_REPORT_SPLIT_BY)[number]

export const CUSTOM_REPORT_CHART_TYPES = ['table', 'bar', 'line', 'area', 'donut'] as const
export type CustomReportChartType = (typeof CUSTOM_REPORT_CHART_TYPES)[number]

export const CUSTOM_REPORT_DATA_TYPES = ['income', 'expense', 'both'] as const
export type CustomReportDataType = (typeof CUSTOM_REPORT_DATA_TYPES)[number]

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
        workspaceId?: string | null
    }
): Promise<CustomReportQueryResult> => {
    const { splitBy, chartType, dataType, groupBy, timezone, workspaceId } = options
    let rows: CustomReportQueryRow[] = []

    if (splitBy === 'total') {
        const [incomeMinor, expenseMinor] = await Promise.all([
            sumPostedTransactionsByType(userId, 'income', period.periodStart, period.periodEnd, workspaceId),
            sumPostedTransactionsByType(userId, 'expense', period.periodStart, period.periodEnd, workspaceId),
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
            timezone,
            workspaceId
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
                computeCategoryBreakdown(userId, period.periodStart, period.periodEnd, 'income', workspaceId),
                computeCategoryBreakdown(userId, period.periodStart, period.periodEnd, 'expense', workspaceId),
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
                type,
                workspaceId
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
            period.periodEnd,
            workspaceId
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
