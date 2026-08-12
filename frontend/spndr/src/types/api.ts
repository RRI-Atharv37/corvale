export interface ApiResponse<T> {
    success: boolean
    data: T
}

export type SupportedCurrency = 'USD' | 'EUR' | 'KRW' | 'INR'

export interface User {
    _id: string
    fullName: string
    email: string
    timezone?: string
    preferredCurrency?: SupportedCurrency
    notificationPreferences?: NotificationPreferences
}

export interface NotificationPreferences {
    billRemindersEnabled: boolean
    billReminderDaysBefore: number
}

export type NotificationType = 'budget_over_limit' | 'bill_due' | 'savings_milestone'

export interface NotificationItem {
    _id: string
    type: NotificationType
    title: string
    message: string
    referenceType?: 'budget' | 'recurring_rule' | 'savings_goal'
    referenceId?: string
    readAt?: string | null
    dismissedAt?: string | null
    metadata?: Record<string, unknown>
    createdAt: string
}

export interface NotificationListPayload {
    notifications: NotificationItem[]
    unreadCount: number
}

export interface AuthPayload {
    token: string
    user: User
}

export interface PaginationMeta {
    totalIncomes?: number
    totalExpenses?: number
    totalTransactions?: number
    pageNumber: number
    totalPages: number
    limit: number
}

export type TransactionType = 'income' | 'expense' | 'transfer'
export type TransactionStatus = 'posted' | 'draft'

export interface Receipt {
    _id: string
    originalFilename: string
    mimeType: string
    size: number
    createdAt?: string
}

export interface Transaction {
    _id: string
    userId: string
    workspaceId?: string | null
    accountId: string
    categoryId: string
    type: TransactionType
    status: TransactionStatus
    amount: number
    currency: string
    title: string
    description?: string
    date: string
    source?: string
    paymentMethod?: string
    tags?: string[]
    transferPairId?: string | null
    splitTransactionId?: string | null
    splits?: SplitLine[]
    transferPair?: Transaction
    receipts?: Receipt[]
    recurringPaymentId?: string | null
    createdAt?: string
    updatedAt?: string
}

export interface SplitLine {
    _id: string
    categoryId: string
    amount: number
    isSplitChild?: true
}

export interface SplitLineFormData {
    categoryId: string
    amount: string
}

export interface TransactionFormData {
    type: 'income' | 'expense'
    title: string
    amount: string
    date: string
    accountId: string
    categoryId: string
    description: string
    source: string
    paymentMethod: string
    tags: string
    splitEnabled: boolean
    splits: SplitLineFormData[]
}

export interface TransferFormData {
    title: string
    amount: string
    date: string
    fromAccountId: string
    toAccountId: string
    description: string
}

export interface TransferCreateResponse {
    outbound: Transaction
    inbound: Transaction
}

export interface BulkDeleteResponse {
    message: string
    deletedCount: number
}

export interface BulkCategoryResponse {
    message: string
    updatedCount: number
}
export interface PaginatedTransactions {
    data: Transaction[]
    meta: PaginationMeta
}

export interface Income {
    _id: string
    userId: string
    title: string
    amount: number
    date: string
    source?: string
    description?: string
    category?: string
    icon?: string
}

export interface Expense {
    _id: string
    userId: string
    title: string
    amount: number
    category: string
    date: string
    description?: string
    paymentMethod?: string
    recurring?: string
    tags?: string[]
}

export interface PaginatedIncome {
    data: Income[]
    meta: PaginationMeta
}

export interface PaginatedExpense {
    data: Expense[]
    meta: PaginationMeta
}

export interface SaverDetails {
    totalIncome: number
    totalExpenses: number
    saverBalance: number
    spendableBalance: number
    netWorth: number
    remainingBalance: number
    totalAccountBalance: number
    liquidBalance: number
    accountCount: number
    balanceSource: 'accounts' | 'legacy'
    saverDate?: string
}

export interface SaverResponse {
    message: string
    data: SaverDetails
}

export interface PushoverSnapshot {
    _id: string
    userId: string
    pushoverAmount: number
    pushoverDate: string
}

export interface PushoverRolloverResponse {
    message: string
    data: {
        pushoverAmount: number
        pushoverBaseline: number
        totalIncome: number
        totalExpenses: number
        saverBalance: number
        spendableBalance: number
        netWorth: number
        remainingBalance: number
    }
}

export interface IncomeFormData {
    title: string
    amount: string
    date: string
    source: string
    description: string
    category: string
}

export interface ExpenseFormData {
    title: string
    amount: string
    category: string
    date: string
    description: string
    paymentMethod: string
    recurring: string
    tags: string
}

export type AccountType = 'checking' | 'cash' | 'credit' | 'savings'

export interface Account {
    _id: string
    userId: string
    workspaceId?: string | null
    name: string
    type: AccountType
    currency: string
    openingBalance: number
    currentBalance: number
    isDefault: boolean
    isArchived: boolean
    createdAt?: string
    updatedAt?: string
}

export interface AccountFormData {
    name: string
    type: AccountType
    currency: string
    openingBalance: string
}

export interface AccountEditFormData {
    name: string
    type: AccountType
}

export interface Category {
    _id: string
    userId: string | null
    masterCategoryId: string | null
    name: string
    icon?: string
    color?: string
    isDefault: boolean
    isArchived: boolean
    sortOrder: number
    createdAt?: string
    updatedAt?: string
}

export interface CategoriesResponse {
    masters: Category[]
    userCategories: Category[]
}

export interface CategoryFormData {
    masterCategoryId: string
    name: string
    icon: string
    color: string
}

export interface CategoryEditFormData {
    name: string
    icon: string
    color: string
}

export type BudgetPeriodType = 'monthly' | 'custom'

export interface BudgetProgress {
    spent: number
    remaining: number
    percentUsed: number
    isOverBudget: boolean
    budgetAmount: number
}

export interface Budget {
    _id: string
    userId: string
    workspaceId?: string | null
    name?: string
    periodType: BudgetPeriodType
    periodStart: string
    periodEnd: string
    categoryId?: string | null
    amount: number
    currency: string
    rollover: boolean
    accountIds: string[]
    isArchived: boolean
    progress?: BudgetProgress
    createdAt?: string
    updatedAt?: string
}

export type BudgetScopeType = 'overall' | 'category'

export interface BudgetFormData {
    name: string
    periodType: BudgetPeriodType
    year: string
    month: string
    periodStart: string
    periodEnd: string
    scopeType: BudgetScopeType
    categoryId: string
    amount: string
    currency: string
    rollover: boolean
    accountIds: string[]
    useAllAccounts: boolean
}

export type SavingsGoalStatus = 'active' | 'paused' | 'completed' | 'archived'
export type AutoContributionInterval = 'weekly' | 'monthly'
export type ContributionType = 'manual' | 'automatic'

export interface AutoContribution {
    enabled: boolean
    amount: number
    interval: AutoContributionInterval
    dayOfMonth?: number
    lastContributedAt?: string
    isDue: boolean
}

export interface SavingsGoalProgress {
    currentAmount: number
    targetAmount: number
    remaining: number
    percentComplete: number
    isComplete: boolean
    requiredMonthlyContribution: number | null
    projectedCompletionDate: string | null
    monthsRemaining: number | null
}

export interface SavingsGoal {
    _id: string
    userId: string
    workspaceId?: string | null
    name: string
    targetAmount: number
    currentAmount: number
    currency: string
    targetDate?: string | null
    status: SavingsGoalStatus
    accountId?: string | null
    autoContribution: AutoContribution
    completedAt?: string | null
    progress?: SavingsGoalProgress
    createdAt?: string
    updatedAt?: string
}

export interface SavingsGoalContribution {
    _id: string
    goalId: string
    amount: number
    type: ContributionType
    note?: string
    contributedAt: string
    createdAt?: string
}

export interface SavingsGoalFormData {
    name: string
    targetAmount: string
    currency: string
    targetDate: string
    accountId: string
    autoContributionEnabled: boolean
    autoContributionAmount: string
    autoContributionInterval: AutoContributionInterval
    autoContributionDayOfMonth: string
}

export interface ContributeResponse {
    message: string
    data: {
        goal: SavingsGoal
        contribution: SavingsGoalContribution
    }
}

export type RecurringInterval =
    | 'daily'
    | 'weekly'
    | 'biweekly'
    | 'monthly'
    | 'quarterly'
    | 'yearly'
    | 'custom'

export type RecurringRuleType = 'income' | 'expense'

export interface RecurringRule {
    _id: string
    userId: string
    workspaceId?: string | null
    title: string
    type: RecurringRuleType
    amount: number
    currency: string
    accountId: string
    categoryId: string
    interval: RecurringInterval
    customIntervalDays?: number
    nextDueDate: string
    description?: string
    paymentMethod?: string
    tags?: string[]
    isActive: boolean
    isArchived: boolean
    createdAt?: string
    updatedAt?: string
}

export interface RecurringRuleFormData {
    title: string
    type: RecurringRuleType
    amount: string
    currency: string
    accountId: string
    categoryId: string
    interval: RecurringInterval
    customIntervalDays: string
    nextDueDate: string
    description: string
    paymentMethod: string
    tags: string
    isActive: boolean
}

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
