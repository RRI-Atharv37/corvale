import type { LocalDb } from '@platform/db/LocalDb'
import { Repository } from '@platform/db/repositories/Repository'
import {
  computeAccountTotalsPure,
  computeUserBalancesPure,
  type CurrencyConversionOptions,
  type UserBalanceSummary,
} from '@shared/balances'
import { resolveMonthlyPeriod } from '@shared/budget'
import { fromMinorUnits, roundMoney } from '@shared/money'
import { resolveDateRange } from '@shared/timezone'
import { listLocalBudgetsWithProgress } from './budgetProgress'
import type { LocalAccount, LocalCategory, LocalTransaction } from './types'

const accountsRepo = new Repository<LocalAccount>('accounts')
const transactionsRepo = new Repository<LocalTransaction>('transactions')
const categoriesRepo = new Repository<LocalCategory>('categories')

export type DashboardGroupBy = 'day' | 'week' | 'month'

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
  periodStart: string
  periodEnd: string
}

export interface NetWorthPoint {
  period: string
  netWorth: number
  cumulativeIncome: number
  cumulativeExpense: number
}

export interface NetWorthTrendResponse {
  series: NetWorthPoint[]
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

const padMonth = (month: number): string => String(month).padStart(2, '0')
const padDay = (day: number): string => String(day).padStart(2, '0')

const parseDateParts = (dateStr: string): { year: number; month: number; day: number } => {
  const [year, month, day] = dateStr.split('-').map(Number)
  return { year, month, day }
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

const formatPeriodKeyFromDate = (date: Date, groupBy: DashboardGroupBy, timezone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const month = parts.find((p) => p.type === 'month')?.value ?? '01'
  const day = parts.find((p) => p.type === 'day')?.value ?? '01'
  return buildPeriodKey(`${year}-${month}-${day}`, groupBy)
}

const enumeratePeriods = (startDate: string, endDate: string, groupBy: DashboardGroupBy): string[] => {
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

const isPostedLedgerEntry = (tx: LocalTransaction): boolean => tx.status === 'posted' && tx.splitTransactionId === null

const toAccountLike = (accounts: LocalAccount[]) =>
  accounts.map((account) => ({
    type: account.type,
    currentBalance: account.currentBalance,
    currency: account.currency,
    isArchived: account.isArchived,
  }))

export const computeLocalCashFlowSeries = async (
  db: LocalDb,
  startDate: string,
  endDate: string,
  groupBy: DashboardGroupBy,
  timezone: string
): Promise<CashFlowPoint[]> => {
  const { start, end } = resolveDateRange(startDate, endDate, timezone)
  const transactions = await transactionsRepo.list(db)

  const incomeByPeriod = new Map<string, number>()
  const expenseByPeriod = new Map<string, number>()

  for (const tx of transactions) {
    if (tx.type === 'transfer' || !isPostedLedgerEntry(tx)) continue
    const date = new Date(tx.date)
    if (date < start || date > end) continue

    const period = formatPeriodKeyFromDate(date, groupBy, timezone)
    const amount = fromMinorUnits(tx.amount)
    const map = tx.type === 'income' ? incomeByPeriod : expenseByPeriod
    map.set(period, roundMoney((map.get(period) ?? 0) + amount))
  }

  return enumeratePeriods(startDate, endDate, groupBy).map((period) => {
    const income = incomeByPeriod.get(period) ?? 0
    const expense = expenseByPeriod.get(period) ?? 0
    return { period, income, expense, net: roundMoney(income - expense) }
  })
}

export const computeLocalCategoryBreakdown = async (
  db: LocalDb,
  startDate: string,
  endDate: string,
  type: 'expense' | 'income',
  timezone: string
): Promise<CategoryBreakdownItem[]> => {
  const { start, end } = resolveDateRange(startDate, endDate, timezone)
  const [transactions, categories] = await Promise.all([transactionsRepo.list(db), categoriesRepo.list(db)])
  const categoryById = new Map(categories.map((category) => [category._id, category]))

  const splitParentIds = new Set(
    transactions.filter((tx) => tx.splitTransactionId !== null).map((tx) => tx.splitTransactionId as string)
  )

  const totalsByMaster = new Map<string, { amount: number; name: string; color?: string }>()

  for (const tx of transactions) {
    if (tx.type !== type || tx.status !== 'posted') continue
    const date = new Date(tx.date)
    if (date < start || date > end) continue
    if (tx.splitTransactionId === null && splitParentIds.has(tx._id)) continue

    const category = categoryById.get(tx.categoryId)
    const masterId = category?.masterCategoryId ?? tx.categoryId
    const master = category?.masterCategoryId ? categoryById.get(masterId) : category

    const amount = fromMinorUnits(tx.amount)
    const existing = totalsByMaster.get(masterId)
    if (existing) {
      existing.amount = roundMoney(existing.amount + amount)
    } else {
      totalsByMaster.set(masterId, { amount, name: master?.name ?? 'Unknown', color: master?.color })
    }
  }

  return [...totalsByMaster.entries()]
    .map(([categoryId, { amount, name, color }]) => ({ categoryId, categoryName: name, amount, color }))
    .sort((a, b) => b.amount - a.amount)
}

export const computeLocalDashboardSummary = async (
  db: LocalDb,
  startDate: string,
  endDate: string,
  timezone: string,
  conversion?: CurrencyConversionOptions
): Promise<DashboardSummary> => {
  const { start, end } = resolveDateRange(startDate, endDate, timezone)
  const [accounts, transactions] = await Promise.all([accountsRepo.list(db), transactionsRepo.list(db)])

  let totalIncomeMinor = 0
  let totalExpensesMinor = 0
  for (const tx of transactions) {
    if (!isPostedLedgerEntry(tx)) continue
    const date = new Date(tx.date)
    if (date < start || date > end) continue
    if (tx.type === 'income') totalIncomeMinor += tx.amount
    else if (tx.type === 'expense') totalExpensesMinor += tx.amount
  }

  const balances: UserBalanceSummary = computeUserBalancesPure({
    accounts: toAccountLike(accounts),
    totalIncomeMajor: fromMinorUnits(totalIncomeMinor),
    totalExpensesMajor: fromMinorUnits(totalExpensesMinor),
    saverBalanceMajor: 0,
    conversion,
  })

  const totalIncome = fromMinorUnits(totalIncomeMinor)
  const totalExpenses = fromMinorUnits(totalExpensesMinor)

  return {
    netWorth: balances.netWorth,
    totalAccountBalance: balances.totalAccountBalance,
    accountCount: balances.accountCount,
    balanceSource: balances.balanceSource,
    spendableBalance: balances.spendableBalance,
    saverBalance: balances.saverBalance,
    netSavings: roundMoney(totalIncome - totalExpenses),
    totalIncome,
    totalExpenses,
    periodStart: startDate,
    periodEnd: endDate,
  }
}

export const computeLocalNetWorthTrend = async (
  db: LocalDb,
  startDate: string,
  endDate: string,
  timezone: string,
  conversion?: CurrencyConversionOptions
): Promise<NetWorthTrendResponse> => {
  const [accounts, cashFlow] = await Promise.all([
    accountsRepo.list(db),
    computeLocalCashFlowSeries(db, startDate, endDate, 'month', timezone),
  ])

  const accountTotals = computeAccountTotalsPure(toAccountLike(accounts), conversion)
  const balanceSource: 'accounts' | 'legacy' = accountTotals.accountCount > 0 ? 'accounts' : 'legacy'

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

  if (balanceSource === 'accounts') {
    let netWorthCursor = accountTotals.totalAccountBalance
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

  return { series, balanceSource, periodStart: startDate, periodEnd: endDate }
}

export const computeLocalBudgetOverview = async (db: LocalDb, timezone: string): Promise<BudgetOverviewResponse> => {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const year = Number(parts.find((p) => p.type === 'year')?.value ?? '1970')
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? '01')

  const { periodStart, periodEnd } = resolveMonthlyPeriod(year, month, timezone)
  const startDate = `${year}-${padMonth(month)}-01`
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const endDate = `${year}-${padMonth(month)}-${padDay(endDay)}`

  const [budgetsWithProgress, categories] = await Promise.all([listLocalBudgetsWithProgress(db), categoriesRepo.list(db)])
  const categoryNameById = new Map(categories.map((category) => [category._id, category.name]))

  const inPeriod = budgetsWithProgress.filter((budget) => {
    if (budget.isArchived) return false
    const budgetStart = new Date(budget.periodStart)
    const budgetEnd = new Date(budget.periodEnd)
    return budgetStart <= periodEnd && budgetEnd >= periodStart
  })

  return {
    periodStart: startDate,
    periodEnd: endDate,
    budgets: inPeriod.map((budget) => ({
      budgetId: budget._id,
      name: budget.name,
      categoryName: budget.categoryId ? categoryNameById.get(budget.categoryId) : undefined,
      budgetAmount: budget.progress.budgetAmount,
      spent: budget.progress.spent,
      remaining: budget.progress.remaining,
      percentUsed: budget.progress.percentUsed,
      isOverBudget: budget.progress.isOverBudget,
    })),
  }
}
