import { buildCsvString } from '@modules/transactions/transactionUtils'
import {
    computeCategoryBreakdown,
    computeDashboardSummary,
} from '@modules/dashboard/dashboardUtils'

import type {
    CustomReportResult,
    IncomeVsExpenseComparison,
    LargestExpenseItem,
    PeriodAverages,
    RecurringTotalsReport,
    SavingsRateReport,
    SpendingTrendPoint,
} from './reportMetrics'

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
