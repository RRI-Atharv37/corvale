import type { LocalDb } from '@platform/db/LocalDb'
import { Repository } from '@platform/db/repositories/Repository'
import { computeAccountTotalsPure, type CurrencyConversionOptions } from '@shared/balances'
import { resolveMonthlyPeriod } from '@shared/budget'
import { fromMinorUnits, roundMoney } from '@shared/money'
import { resolveDateRange } from '@shared/timezone'
import { listLocalBudgetsWithProgress } from './budgetProgress'
import {
  computeLocalCashFlowSeries,
  computeLocalCategoryBreakdown,
  computeLocalDashboardSummary,
  computeLocalNetWorthTrend,
  type CategoryBreakdownItem,
  type NetWorthPoint,
} from './dashboard'
import type { LocalAccount, LocalCategory, LocalRecurringRule, LocalTransaction } from './types'

/**
 * Sprint 13.10: local port of `backend/utils/reportUtils.ts`'s 9 core report
 * metrics (everything except `categoryBreakdown`/`summary`, which the
 * Reports page already gets from `domain/dashboard.ts`'s Sprint 13.5 work -
 * see that file's `computeLocalCategoryBreakdown`/`computeLocalDashboardSummary`).
 * Every function here mirrors its `reportUtils.ts` counterpart's math and
 * output shape exactly (rounding, minor/major-unit conversions, the
 * split-children and draft/transfer exclusion rules) so the Reports page's
 * rendering code needs no changes when switched to local computation.
 */

const transactionsRepo = new Repository<LocalTransaction>('transactions')
const categoriesRepo = new Repository<LocalCategory>('categories')
const recurringRulesRepo = new Repository<LocalRecurringRule>('recurringRules')
const accountsRepo = new Repository<LocalAccount>('accounts')

/**
 * `LocalTransaction` (domain/types.ts) has no `currency`/`recurringPaymentId`
 * fields yet - both round-trip fine through the JSON `data` blob (Repository
 * stores the full server doc); this just widens the local type for the
 * report computations that need them, mirroring the identical widening in
 * `pages/Dashboard/hooks/useTransactionsData.ts`'s `LocalTransactionRecord`.
 */
interface LocalTransactionExt extends LocalTransaction {
  currency?: string
  recurringPaymentId?: string | null
}

export type ReportPeriodType = 'monthly' | 'yearly' | 'custom'

export interface ReportPeriodQuery {
  periodType: ReportPeriodType
  year?: number | string
  month?: number | string
  startDate?: string
  endDate?: string
}

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
  monthlyBreakdown?: Array<{ period: string; income: number; expense: number; net: number }>
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
  interval: LocalRecurringRule['interval']
  monthlyEquivalent: number
}

export interface RecurringTotalsReport {
  activeExpenseRules: RecurringExpenseRuleTotal[]
  totalMonthlyEquivalent: number
  postedRecurringExpensesInPeriod: number
  periodStart: string
  periodEnd: string
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
  series: Array<{ period: string; cumulativeIncome: number; cumulativeExpense: number; gap: number }>
}

export interface BalanceBreakdown {
  liquid: number
  savings: number
  credit: number
  saver: number
  spendable: number
  netWorth: number
}

export interface NetWorthOverview {
  series: NetWorthPoint[]
  currentBalances: BalanceBreakdown
  balanceSource: 'accounts' | 'legacy'
  periodStart: string
  periodEnd: string
}

const padMonth = (month: number): string => String(month).padStart(2, '0')

const daysInclusive = (startDate: string, endDate: string): number => {
  const start = new Date(`${startDate}T12:00:00.000Z`)
  const end = new Date(`${endDate}T12:00:00.000Z`)
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
}

const isPostedLedgerEntry = (tx: LocalTransaction): boolean => tx.status === 'posted' && tx.splitTransactionId === null

const sumIncomeExpenseInPeriod = (
  transactions: LocalTransaction[],
  start: Date,
  end: Date
): { totalIncome: number; totalExpenses: number } => {
  let incomeMinor = 0
  let expenseMinor = 0
  for (const tx of transactions) {
    if (!isPostedLedgerEntry(tx)) continue
    const date = new Date(tx.date)
    if (date < start || date > end) continue
    if (tx.type === 'income') incomeMinor += tx.amount
    else if (tx.type === 'expense') expenseMinor += tx.amount
  }
  return { totalIncome: fromMinorUnits(incomeMinor), totalExpenses: fromMinorUnits(expenseMinor) }
}

/** Split children (non-null `splitTransactionId`) count; a split parent that has children is
 * excluded once (to avoid double counting against its children's category-level amounts) - mirrors
 * the server's `$or: [{splitTransactionId: {$ne: null}}, {splitTransactionId: null, _id: {$nin: splitParentIds}}]`
 * filter shared by `computeLargestExpenses`/`computeCategoryBreakdown`/`computePaymentMethodBreakdown`. */
const buildSplitParentIdSet = (transactions: LocalTransaction[]): Set<string> =>
  new Set(transactions.filter((tx) => tx.splitTransactionId !== null).map((tx) => tx.splitTransactionId as string))

const isBreakdownEligibleExpense = (
  tx: LocalTransaction,
  splitParentIds: Set<string>,
  start: Date,
  end: Date
): boolean => {
  if (tx.type !== 'expense' || tx.status !== 'posted') return false
  const date = new Date(tx.date)
  if (date < start || date > end) return false
  if (tx.splitTransactionId === null && splitParentIds.has(tx._id)) return false
  return true
}

const resolveTrend = (changePercent: number | null): 'up' | 'down' | 'flat' => {
  if (changePercent === null || Math.abs(changePercent) < 1) return 'flat'
  return changePercent > 0 ? 'up' : 'down'
}

/**
 * Local counterpart to `resolveReportPeriod` (`backend/utils/reportUtils.ts`). Unlike the server,
 * this throws a plain `Error` (no `CustomError`/HTTP status - there's no HTTP layer here) and
 * requires explicit `startDate`/`endDate` for `custom` periods rather than defaulting to the last 6
 * months, since `Reports.tsx` always supplies both explicitly for every period type.
 */
export const resolveLocalReportPeriod = (query: ReportPeriodQuery, timezone: string): ReportPeriod => {
  const periodType = query.periodType

  if (periodType === 'monthly') {
    const year = Number(query.year)
    const month = Number(query.month)
    if (!Number.isInteger(year) || !Number.isInteger(month)) {
      throw new Error('Monthly reports require year and month')
    }
    const { periodStart, periodEnd } = resolveMonthlyPeriod(year, month, timezone)
    const startDate = `${year}-${padMonth(month)}-01`
    const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const endDate = `${year}-${padMonth(month)}-${String(endDay).padStart(2, '0')}`
    return { periodType, periodStart, periodEnd, startDate, endDate }
  }

  if (periodType === 'yearly') {
    const year = Number(query.year)
    if (!Number.isInteger(year)) {
      throw new Error('Yearly reports require year')
    }
    const startDate = `${year}-01-01`
    const endDate = `${year}-12-31`
    const { start: periodStart, end: periodEnd } = resolveDateRange(startDate, endDate, timezone)
    return { periodType, periodStart, periodEnd, startDate, endDate }
  }

  if (!query.startDate || !query.endDate) {
    throw new Error('Custom reports require startDate and endDate')
  }
  const { start: periodStart, end: periodEnd } = resolveDateRange(query.startDate, query.endDate, timezone)
  return { periodType: 'custom', periodStart, periodEnd, startDate: query.startDate, endDate: query.endDate }
}

export const computeLocalPeriodAverages = async (
  db: LocalDb,
  period: ReportPeriod,
  timezone: string
): Promise<PeriodAverages> => {
  const transactions = await transactionsRepo.list(db)
  const { totalIncome, totalExpenses } = sumIncomeExpenseInPeriod(transactions, period.periodStart, period.periodEnd)
  const netSavings = roundMoney(totalIncome - totalExpenses)

  if (period.periodType === 'yearly') {
    const monthlyBreakdown = await computeLocalCashFlowSeries(db, period.startDate, period.endDate, 'month', timezone)
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

export const computeLocalLargestExpenses = async (
  db: LocalDb,
  period: ReportPeriod,
  limit = 10
): Promise<LargestExpensesResponse> => {
  const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), 50)
  const [transactions, categories] = await Promise.all([transactionsRepo.list(db), categoriesRepo.list(db)])
  const categoryById = new Map(categories.map((category) => [category._id, category]))
  const splitParentIds = buildSplitParentIdSet(transactions)

  const filtered = (transactions as LocalTransactionExt[]).filter((tx) =>
    isBreakdownEligibleExpense(tx, splitParentIds, period.periodStart, period.periodEnd)
  )
  filtered.sort((a, b) => b.amount - a.amount)

  const expenses: LargestExpenseItem[] = filtered.slice(0, cappedLimit).map((tx) => {
    const category = categoryById.get(tx.categoryId)
    return {
      transactionId: tx._id,
      title: tx.title,
      amount: fromMinorUnits(tx.amount),
      currency: tx.currency ?? 'USD',
      date: tx.date,
      categoryId: tx.categoryId,
      categoryName: category?.name ?? 'Unknown',
    }
  })

  return { periodStart: period.startDate, periodEnd: period.endDate, expenses }
}

export const computeLocalSpendingTrends = async (
  db: LocalDb,
  period: ReportPeriod,
  timezone: string
): Promise<SpendingTrendsResponse> => {
  const series = await computeLocalCashFlowSeries(db, period.startDate, period.endDate, 'month', timezone)

  const trends: SpendingTrendPoint[] = series.map((point, index) => {
    const previous = index > 0 ? series[index - 1].expense : null
    const changePercent =
      previous !== null && previous > 0 ? roundMoney(((point.expense - previous) / previous) * 100) : null
    return { period: point.period, expense: point.expense, changePercent, trend: resolveTrend(changePercent) }
  })

  return { periodStart: period.startDate, periodEnd: period.endDate, trends }
}

export const computeLocalIncomeVsExpense = async (db: LocalDb, period: ReportPeriod): Promise<IncomeVsExpenseResponse> => {
  const transactions = await transactionsRepo.list(db)
  const { totalIncome, totalExpenses } = sumIncomeExpenseInPeriod(transactions, period.periodStart, period.periodEnd)
  const netSavings = roundMoney(totalIncome - totalExpenses)
  const combined = totalIncome + totalExpenses

  return {
    periodStart: period.startDate,
    periodEnd: period.endDate,
    totalIncome,
    totalExpenses,
    netSavings,
    expenseToIncomeRatio: totalIncome > 0 ? roundMoney(totalExpenses / totalIncome) : 0,
    incomeShare: combined > 0 ? roundMoney(totalIncome / combined) : 0,
    expenseShare: combined > 0 ? roundMoney(totalExpenses / combined) : 0,
  }
}

export const computeLocalSavingsRate = async (db: LocalDb, period: ReportPeriod): Promise<SavingsRateReport> => {
  const transactions = await transactionsRepo.list(db)
  const { totalIncome, totalExpenses } = sumIncomeExpenseInPeriod(transactions, period.periodStart, period.periodEnd)
  const netSavings = roundMoney(totalIncome - totalExpenses)
  const savingsRate = totalIncome > 0 ? roundMoney((netSavings / totalIncome) * 100) : 0

  return {
    savingsRate,
    totalIncome,
    totalExpenses,
    netSavings,
    periodStart: period.startDate,
    periodEnd: period.endDate,
  }
}

const monthlyEquivalentForRule = (rule: LocalRecurringRule): number => {
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

export const computeLocalRecurringTotals = async (db: LocalDb, period: ReportPeriod): Promise<RecurringTotalsReport> => {
  const [rules, transactions] = await Promise.all([recurringRulesRepo.list(db), transactionsRepo.list(db)])

  const activeExpenseRules: RecurringExpenseRuleTotal[] = rules
    .filter((rule) => rule.type === 'expense' && rule.isActive && !rule.isArchived)
    .map((rule) => ({
      ruleId: rule._id,
      title: rule.title,
      amount: fromMinorUnits(rule.amount),
      currency: rule.currency,
      interval: rule.interval,
      monthlyEquivalent: monthlyEquivalentForRule(rule),
    }))

  const totalMonthlyEquivalent = roundMoney(activeExpenseRules.reduce((sum, rule) => sum + rule.monthlyEquivalent, 0))

  let postedRecurringMinor = 0
  for (const tx of transactions as LocalTransactionExt[]) {
    if (tx.type !== 'expense' || tx.status !== 'posted' || tx.splitTransactionId !== null) continue
    if (!tx.recurringPaymentId) continue
    const date = new Date(tx.date)
    if (date < period.periodStart || date > period.periodEnd) continue
    postedRecurringMinor += tx.amount
  }

  return {
    activeExpenseRules,
    totalMonthlyEquivalent,
    postedRecurringExpensesInPeriod: fromMinorUnits(postedRecurringMinor),
    periodStart: period.startDate,
    periodEnd: period.endDate,
  }
}

export const computeLocalBudgetAnalysis = async (db: LocalDb, period: ReportPeriod): Promise<BudgetAnalysisReport> => {
  const [budgetsWithProgress, categories] = await Promise.all([listLocalBudgetsWithProgress(db), categoriesRepo.list(db)])
  const categoryNameById = new Map(categories.map((category) => [category._id, category.name]))

  const inPeriod = budgetsWithProgress
    .filter((budget) => {
      if (budget.isArchived) return false
      const budgetStart = new Date(budget.periodStart)
      const budgetEnd = new Date(budget.periodEnd)
      return budgetStart <= period.periodEnd && budgetEnd >= period.periodStart
    })
    .sort((a, b) => new Date(b.periodStart).getTime() - new Date(a.periodStart).getTime())

  const items: BudgetAnalysisItem[] = inPeriod.map((budget) => ({
    budgetId: budget._id,
    name: budget.name,
    categoryName: budget.categoryId ? categoryNameById.get(budget.categoryId) : undefined,
    budgetAmount: budget.progress.budgetAmount,
    spent: budget.progress.spent,
    remaining: budget.progress.remaining,
    percentUsed: budget.progress.percentUsed,
    isOverBudget: budget.progress.isOverBudget,
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

const computeLocalPaymentMethodBreakdown = (
  transactions: LocalTransaction[],
  splitParentIds: Set<string>,
  period: ReportPeriod
): PaymentMethodBreakdownItem[] => {
  const totals = new Map<string, number>()
  for (const tx of transactions) {
    if (!isBreakdownEligibleExpense(tx, splitParentIds, period.periodStart, period.periodEnd)) continue
    const method = tx.paymentMethod ?? 'Unspecified'
    totals.set(method, (totals.get(method) ?? 0) + tx.amount)
  }
  return [...totals.entries()]
    .map(([paymentMethod, minor]) => ({ paymentMethod, amount: fromMinorUnits(minor) }))
    .sort((a, b) => b.amount - a.amount)
}

export const computeLocalSpendingAnalysis = async (
  db: LocalDb,
  period: ReportPeriod,
  timezone: string,
  largestLimit = 10
): Promise<SpendingAnalysisReport> => {
  const [transactions, topCategories, largestExpensesResp, trendsResp] = await Promise.all([
    transactionsRepo.list(db),
    computeLocalCategoryBreakdown(db, period.startDate, period.endDate, 'expense', timezone),
    computeLocalLargestExpenses(db, period, largestLimit),
    computeLocalSpendingTrends(db, period, timezone),
  ])

  const splitParentIds = buildSplitParentIdSet(transactions)
  const transactionCount = transactions.filter((tx) =>
    isBreakdownEligibleExpense(tx, splitParentIds, period.periodStart, period.periodEnd)
  ).length

  const { totalExpenses } = sumIncomeExpenseInPeriod(transactions, period.periodStart, period.periodEnd)
  const topPaymentMethods = computeLocalPaymentMethodBreakdown(transactions, splitParentIds, period)

  return {
    periodStart: period.startDate,
    periodEnd: period.endDate,
    totalExpenses,
    transactionCount,
    averagePerTransaction: transactionCount > 0 ? roundMoney(totalExpenses / transactionCount) : 0,
    topCategories,
    topPaymentMethods,
    largestExpenses: largestExpensesResp.expenses,
    trends: trendsResp.trends,
  }
}

export const computeLocalCrossoverPoint = async (
  db: LocalDb,
  period: ReportPeriod,
  timezone: string
): Promise<CrossoverPointReport> => {
  const cashFlow = await computeLocalCashFlowSeries(db, period.startDate, period.endDate, 'month', timezone)

  let cumulativeIncome = 0
  let cumulativeExpense = 0
  let crossoverPeriod: string | null = null
  let monthlyCrossoverPeriod: string | null = null
  let cumulativeIncomeAtCrossover: number | null = null
  let cumulativeExpenseAtCrossover: number | null = null

  const series = cashFlow.map((point) => {
    cumulativeIncome = roundMoney(cumulativeIncome + point.income)
    cumulativeExpense = roundMoney(cumulativeExpense + point.expense)

    if (crossoverPeriod === null && cumulativeIncome >= cumulativeExpense && cumulativeExpense > 0) {
      crossoverPeriod = point.period
      cumulativeIncomeAtCrossover = cumulativeIncome
      cumulativeExpenseAtCrossover = cumulativeExpense
    }

    if (monthlyCrossoverPeriod === null && point.income >= point.expense && point.expense > 0) {
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

/**
 * `domain/dashboard.ts`'s `computeLocalNetWorthTrend` (Sprint 13.5) only returns the trend
 * `series`/`balanceSource` - the Reports page's `NetWorthChart` also needs a `currentBalances`
 * breakdown (mirrors `backend/utils/dashboardUtils.ts`'s `computeNetWorthTrend`, whose
 * `currentBalances.liquid` is deliberately *not* currency-converted, matching that function's own
 * unconverted `computeAccountTotals(userId, workspaceId)` call - replicated as-is here for parity).
 */
export const computeLocalNetWorthOverview = async (
  db: LocalDb,
  startDate: string,
  endDate: string,
  timezone: string,
  conversion?: CurrencyConversionOptions
): Promise<NetWorthOverview> => {
  const [trend, summary, accounts] = await Promise.all([
    computeLocalNetWorthTrend(db, startDate, endDate, timezone, conversion),
    computeLocalDashboardSummary(db, startDate, endDate, timezone, conversion),
    accountsRepo.list(db),
  ])

  const activeAccounts = accounts.filter((account) => !account.isArchived)
  const accountTotals = computeAccountTotalsPure(
    activeAccounts.map((account) => ({
      type: account.type,
      currentBalance: account.currentBalance,
      currency: account.currency,
      isArchived: account.isArchived,
    }))
  )

  let savings = 0
  let credit = 0
  for (const account of activeAccounts) {
    const balance = roundMoney(account.currentBalance)
    if (account.type === 'credit') credit = roundMoney(credit + balance)
    else if (account.type === 'savings') savings = roundMoney(savings + balance)
  }

  return {
    series: trend.series,
    currentBalances: {
      liquid: trend.balanceSource === 'accounts' ? accountTotals.liquidBalance : 0,
      savings,
      credit,
      saver: summary.saverBalance,
      spendable: summary.spendableBalance,
      netWorth: summary.netWorth,
    },
    balanceSource: trend.balanceSource,
    periodStart: trend.periodStart,
    periodEnd: trend.periodEnd,
  }
}
