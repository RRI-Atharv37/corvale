import type { CategoryBreakdownItem, DashboardGroupBy } from '@features/dashboard/types'

export type ReportPeriodType = 'monthly' | 'yearly' | 'custom'

export type ReportMetricKey =
    | 'summary'
    | 'averages'
    | 'largestExpenses'
    | 'spendingTrends'
    | 'incomeVsExpense'
    | 'savingsRate'
    | 'recurringTotals'
    | 'categoryBreakdown'
    | 'budgetAnalysis'
    | 'spendingAnalysis'
    | 'crossoverPoint'

export type CustomReportSplitBy = 'total' | 'time' | 'category' | 'paymentMethod'
export type CustomReportChartType = 'table' | 'bar' | 'line' | 'area' | 'donut'
export type CustomReportDataType = 'income' | 'expense' | 'both'

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

export interface LargestExpensesResponse {
    periodStart: string
    periodEnd: string
    expenses: LargestExpenseItem[]
}

export interface SpendingTrendPoint {
    period: string
    expense: number
    changePercent: number | null
    trend: 'up' | 'down' | 'flat'
}

export interface SpendingTrendsResponse {
    periodStart: string
    periodEnd: string
    trends: SpendingTrendPoint[]
}

export interface IncomeVsExpenseResponse {
    periodStart: string
    periodEnd: string
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
    interval: string
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

export interface PaymentMethodBreakdownItem {
    paymentMethod: string
    amount: number
}

export interface SpendingAnalysisReport {
    periodStart: string
    periodEnd: string
    totalExpenses: number
    transactionCount: number
    averagePerTransaction: number
    topCategories: CategoryBreakdownItem[]
    topPaymentMethods: PaymentMethodBreakdownItem[]
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

export interface SavedReportConfig {
    periodType: ReportPeriodType
    year?: number
    month?: number
    startDate?: string
    endDate?: string
    splitBy: CustomReportSplitBy
    chartType: CustomReportChartType
    dataType: CustomReportDataType
    groupBy?: DashboardGroupBy
}

export interface SavedReport {
    _id: string
    userId: string
    name: string
    config: SavedReportConfig
    createdAt?: string
    updatedAt?: string
}

export interface SavedReportRunResult {
    savedReportId: string
    name: string
    config: SavedReportConfig
    result: CustomReportQueryResult
}
