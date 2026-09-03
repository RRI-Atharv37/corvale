export type DashboardGroupBy = 'day' | 'week' | 'month'

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

export interface CashFlowPoint {
    period: string
    income: number
    expense: number
    net: number
}

export interface DashboardCashFlowResponse {
    groupBy: DashboardGroupBy
    periodStart: string
    periodEnd: string
    series: CashFlowPoint[]
}

export interface CategoryBreakdownItem {
    categoryId: string
    categoryName: string
    amount: number
    color?: string
}

export interface DashboardCategoryBreakdownResponse {
    type: 'expense' | 'income'
    breakdown: CategoryBreakdownItem[]
}

export type DashboardPeriodPreset = '1m' | '3m' | '6m' | '12m' | 'ytd'
