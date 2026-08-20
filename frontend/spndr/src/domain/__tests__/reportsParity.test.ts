import { describe, expect, it } from 'vitest'
import { MemorySqliteDriver } from '../../db/MemorySqliteDriver'
import { runMigrations } from '../../db/migrations/runMigrations'
import { MIGRATIONS } from '../../db/migrations/schema'
import { Repository } from '../../db/repositories/Repository'
import type { LocalDb } from '../../db/LocalDb'

import {
  computeLocalBudgetAnalysis,
  computeLocalCrossoverPoint,
  computeLocalIncomeVsExpense,
  computeLocalLargestExpenses,
  computeLocalNetWorthOverview,
  computeLocalPeriodAverages,
  computeLocalRecurringTotals,
  computeLocalSavingsRate,
  computeLocalSpendingAnalysis,
  computeLocalSpendingTrends,
  resolveLocalReportPeriod,
} from '../reports'

import type { LocalAccount, LocalBudget, LocalCategory, LocalRecurringRule, LocalTransaction } from '../types'

/**
 * Sprint 13.10 acceptance criteria: local report computation over the local SQLite store must match
 * the server's computation (`backend/utils/reportUtils.ts`, exercised end-to-end in
 * `backend/tests/reports.test.ts`) for identical data. The fixture below is copied verbatim (same
 * titles, amounts, dates, budget/recurring-rule config) from that suite's `seedReportFixture`, and
 * every expected value asserted here is copied verbatim from the matching `reports.test.ts` case -
 * this is a genuine cross-check against the server's math, not a tautological "call the same code
 * twice" test. Mirrors `localDomainParity.test.ts`'s pattern (Sprint 13.5) exactly.
 */

const TIMEZONE = 'UTC'

const freshDb = async (): Promise<LocalDb> => {
  const db = await MemorySqliteDriver.create()
  await runMigrations(db, MIGRATIONS)
  return db
}

const nowIso = () => new Date().toISOString()

const accountsRepo = new Repository<LocalAccount>('accounts')
const transactionsRepo = new Repository<LocalTransaction>('transactions')
const categoriesRepo = new Repository<LocalCategory>('categories')
const budgetsRepo = new Repository<LocalBudget>('budgets')
const rulesRepo = new Repository<LocalRecurringRule>('recurringRules')

let idCounter = 0
const nextId = (): string => {
  idCounter += 1
  return `id-${idCounter.toString().padStart(6, '0')}`
}

interface ReportFixtureIds {
  accountId: string
  foodCategoryId: string
  transportCategoryId: string
  incomeCategoryId: string
  recurringRuleId: string
}

/**
 * Verbatim port of `backend/tests/reports.test.ts`'s `seedReportFixture`: a checking account, three
 * master categories (Food/Transport/Income), a salary + two January expenses + one December expense,
 * a $1000 "January overall" monthly budget, and one active monthly Netflix recurring rule.
 * `includePostedRecurring` mirrors the backend fixture's `userId` parameter - only some server tests
 * pass it, which additionally posts a $15.99 expense linked to the recurring rule via
 * `recurringPaymentId` (raw `Transaction.create`, bypassing the API's minor-unit conversion, so the
 * `amount: 1599` there is already minor units - matched here as-is).
 */
const seedReportFixture = async (db: LocalDb, includePostedRecurring: boolean): Promise<ReportFixtureIds> => {
  const accountId = nextId()
  const foodCategoryId = nextId()
  const transportCategoryId = nextId()
  const incomeCategoryId = nextId()
  const recurringRuleId = nextId()

  await accountsRepo.upsertFromServer(db, [
    {
      _id: accountId,
      updatedAt: nowIso(),
      userId: 'u1',
      name: 'Checking',
      type: 'checking',
      currency: 'USD',
      currentBalance: 5000,
      isArchived: false,
    },
  ])

  await categoriesRepo.upsertFromServer(db, [
    { _id: foodCategoryId, updatedAt: nowIso(), userId: null, masterCategoryId: null, name: 'Food', isArchived: false },
    {
      _id: transportCategoryId,
      updatedAt: nowIso(),
      userId: null,
      masterCategoryId: null,
      name: 'Transport',
      isArchived: false,
    },
    {
      _id: incomeCategoryId,
      updatedAt: nowIso(),
      userId: null,
      masterCategoryId: null,
      name: 'Income',
      isArchived: false,
    },
  ])

  const transactions: LocalTransaction[] = [
    {
      _id: nextId(),
      updatedAt: nowIso(),
      userId: 'u1',
      accountId,
      categoryId: incomeCategoryId,
      type: 'income',
      status: 'posted',
      amount: 300000,
      title: 'Salary',
      date: '2026-01-05T12:00:00.000Z',
      splitTransactionId: null,
    },
    {
      _id: nextId(),
      updatedAt: nowIso(),
      userId: 'u1',
      accountId,
      categoryId: foodCategoryId,
      type: 'expense',
      status: 'posted',
      amount: 50000,
      title: 'Groceries',
      date: '2026-01-10T12:00:00.000Z',
      splitTransactionId: null,
    },
    {
      _id: nextId(),
      updatedAt: nowIso(),
      userId: 'u1',
      accountId,
      categoryId: transportCategoryId,
      type: 'expense',
      status: 'posted',
      amount: 30000,
      title: 'Bus pass',
      date: '2026-01-15T12:00:00.000Z',
      splitTransactionId: null,
    },
    {
      _id: nextId(),
      updatedAt: nowIso(),
      userId: 'u1',
      accountId,
      categoryId: foodCategoryId,
      type: 'expense',
      status: 'posted',
      amount: 20000,
      title: 'Holiday gifts',
      date: '2025-12-20T12:00:00.000Z',
      splitTransactionId: null,
    },
  ]

  if (includePostedRecurring) {
    transactions.push({
      _id: nextId(),
      updatedAt: nowIso(),
      userId: 'u1',
      accountId,
      categoryId: foodCategoryId,
      type: 'expense',
      status: 'posted',
      amount: 1599,
      title: 'Posted recurring Netflix',
      date: '2026-01-12T12:00:00.000Z',
      splitTransactionId: null,
      recurringPaymentId: recurringRuleId,
    } as LocalTransaction)
  }

  await transactionsRepo.upsertFromServer(db, transactions)

  await budgetsRepo.upsertFromServer(db, [
    {
      _id: nextId(),
      updatedAt: nowIso(),
      userId: 'u1',
      name: 'January overall',
      categoryId: null,
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-01-31T23:59:59.999Z',
      amount: 100000,
      accountIds: [],
      isArchived: false,
    },
  ])

  await rulesRepo.upsertFromServer(db, [
    {
      _id: recurringRuleId,
      updatedAt: nowIso(),
      userId: 'u1',
      title: 'Netflix',
      type: 'expense',
      amount: 1599,
      currency: 'USD',
      accountId,
      categoryId: foodCategoryId,
      interval: 'monthly',
      nextDueDate: '2026-02-01',
      isActive: true,
      isArchived: false,
      isCancelled: false,
    },
  ])

  return { accountId, foodCategoryId, transportCategoryId, incomeCategoryId, recurringRuleId }
}

const JAN_2026_MONTHLY = { periodType: 'monthly' as const, year: 2026, month: 1 }
const JAN_2026_CUSTOM = { periodType: 'custom' as const, startDate: '2026-01-01', endDate: '2026-01-31' }

describe('local reports engine: period averages', () => {
  it('returns daily averages for a custom period (matches server: income 3000, expenses 800, 31 days)', async () => {
    const db = await freshDb()
    await seedReportFixture(db, false)

    const period = resolveLocalReportPeriod(JAN_2026_CUSTOM, TIMEZONE)
    const averages = await computeLocalPeriodAverages(db, period, TIMEZONE)

    expect(averages.totalIncome).toBe(3000)
    expect(averages.totalExpenses).toBe(800)
    expect(averages.netSavings).toBe(2200)
    expect(averages.unit).toBe('day')
    expect(averages.unitCount).toBe(31)
    expect(averages.averageIncome).toBeCloseTo(3000 / 31, 2)
  })

  it('returns monthly-period totals scoped to the resolved period boundaries (matches server)', async () => {
    const db = await freshDb()
    await seedReportFixture(db, false)

    const period = resolveLocalReportPeriod(JAN_2026_MONTHLY, TIMEZONE)
    const averages = await computeLocalPeriodAverages(db, period, TIMEZONE)

    expect(averages.periodStart).toBe('2026-01-01')
    expect(averages.periodEnd).toBe('2026-01-31')
    expect(averages.totalIncome).toBe(3000)
    expect(averages.totalExpenses).toBe(800)
  })

  it('returns a monthly breakdown for a yearly period (matches server structural shape)', async () => {
    const db = await freshDb()
    await seedReportFixture(db, false)

    const period = resolveLocalReportPeriod({ periodType: 'yearly', year: 2026 }, TIMEZONE)
    const averages = await computeLocalPeriodAverages(db, period, TIMEZONE)

    expect(averages.periodType).toBe('yearly')
    expect(averages.unit).toBe('month')
    expect(Array.isArray(averages.monthlyBreakdown)).toBe(true)
  })
})

describe('local reports engine: largest expenses', () => {
  it('returns posted expenses sorted by amount descending (matches server)', async () => {
    const db = await freshDb()
    await seedReportFixture(db, false)

    const period = resolveLocalReportPeriod({ ...JAN_2026_MONTHLY }, TIMEZONE)
    const result = await computeLocalLargestExpenses(db, period, 5)

    expect(result.expenses).toHaveLength(2)
    expect(result.expenses[0].title).toBe('Groceries')
    expect(result.expenses[0].amount).toBe(500)
    expect(result.expenses[1].title).toBe('Bus pass')
    expect(result.expenses[1].amount).toBe(300)
  })
})

describe('local reports engine: spending trends', () => {
  it('flags a flat trend when there is no prior-month spend to compare against (matches server)', async () => {
    const db = await freshDb()
    await seedReportFixture(db, false)

    const period = resolveLocalReportPeriod({ periodType: 'yearly', year: 2025 }, TIMEZONE)
    const result = await computeLocalSpendingTrends(db, period, TIMEZONE)

    expect(result.trends.length).toBeGreaterThan(0)
    const december = result.trends.find((point) => point.period === '2025-12')
    expect(december?.expense).toBe(200)
    expect(december?.trend).toBe('flat')
  })
})

describe('local reports engine: income vs expense', () => {
  it('returns comparison ratios for the selected period (matches server)', async () => {
    const db = await freshDb()
    await seedReportFixture(db, false)

    const period = resolveLocalReportPeriod(JAN_2026_MONTHLY, TIMEZONE)
    const result = await computeLocalIncomeVsExpense(db, period)

    expect(result.totalIncome).toBe(3000)
    expect(result.totalExpenses).toBe(800)
    expect(result.netSavings).toBe(2200)
    expect(result.expenseToIncomeRatio).toBeCloseTo(800 / 3000, 2)
  })
})

describe('local reports engine: savings rate', () => {
  it('returns savings rate as a percentage of income (matches server)', async () => {
    const db = await freshDb()
    await seedReportFixture(db, false)

    const period = resolveLocalReportPeriod(JAN_2026_MONTHLY, TIMEZONE)
    const result = await computeLocalSavingsRate(db, period)

    expect(result.totalIncome).toBe(3000)
    expect(result.totalExpenses).toBe(800)
    expect(result.netSavings).toBe(2200)
    expect(result.savingsRate).toBeCloseTo((2200 / 3000) * 100, 2)
  })

  it('returns zero rate/totals for a user with no transactions in the period (matches server)', async () => {
    const db = await freshDb()
    await accountsRepo.upsertFromServer(db, [
      {
        _id: nextId(),
        updatedAt: nowIso(),
        userId: 'u1',
        name: 'Checking',
        type: 'checking',
        currency: 'USD',
        currentBalance: 0,
        isArchived: false,
      },
    ])

    const period = resolveLocalReportPeriod(JAN_2026_MONTHLY, TIMEZONE)
    const result = await computeLocalSavingsRate(db, period)

    expect(result.totalIncome).toBe(0)
    expect(result.totalExpenses).toBe(0)
    expect(result.savingsRate).toBe(0)
  })

  it('excludes draft transactions from report totals (matches server: totalExpenses stays 800)', async () => {
    const db = await freshDb()
    const { accountId, foodCategoryId } = await seedReportFixture(db, false)

    await transactionsRepo.upsertFromServer(db, [
      {
        _id: nextId(),
        updatedAt: nowIso(),
        userId: 'u1',
        accountId,
        categoryId: foodCategoryId,
        type: 'expense',
        status: 'draft',
        amount: 500000,
        title: 'Draft expense',
        date: '2026-01-18T12:00:00.000Z',
        splitTransactionId: null,
      },
    ])

    const period = resolveLocalReportPeriod(JAN_2026_MONTHLY, TIMEZONE)
    const result = await computeLocalSavingsRate(db, period)

    expect(result.totalExpenses).toBe(800)
  })
})

describe('local reports engine: recurring totals', () => {
  it('returns active recurring rules and posted recurring expenses in period (matches server)', async () => {
    const db = await freshDb()
    await seedReportFixture(db, true)

    const period = resolveLocalReportPeriod(JAN_2026_MONTHLY, TIMEZONE)
    const result = await computeLocalRecurringTotals(db, period)

    expect(result.activeExpenseRules).toHaveLength(1)
    expect(result.activeExpenseRules[0].title).toBe('Netflix')
    expect(result.activeExpenseRules[0].monthlyEquivalent).toBe(15.99)
    expect(result.totalMonthlyEquivalent).toBe(15.99)
    expect(result.postedRecurringExpensesInPeriod).toBe(15.99)
  })
})

describe('local reports engine: budget analysis', () => {
  it('returns budget progress for budgets overlapping the period (matches server)', async () => {
    const db = await freshDb()
    await seedReportFixture(db, false)

    const period = resolveLocalReportPeriod(JAN_2026_MONTHLY, TIMEZONE)
    const result = await computeLocalBudgetAnalysis(db, period)

    expect(result.budgets).toHaveLength(1)
    expect(result.budgets[0].budgetAmount).toBe(1000)
    expect(result.budgets[0].spent).toBe(800)
    expect(result.totalBudgeted).toBe(1000)
    expect(result.totalSpent).toBe(800)
    expect(result.overBudgetCount).toBe(0)
  })
})

describe('local reports engine: spending analysis', () => {
  it('returns aggregate spending metrics with top categories and trends (matches server)', async () => {
    const db = await freshDb()
    await seedReportFixture(db, false)

    const period = resolveLocalReportPeriod({ ...JAN_2026_MONTHLY }, TIMEZONE)
    const result = await computeLocalSpendingAnalysis(db, period, TIMEZONE, 5)

    expect(result.totalExpenses).toBe(800)
    expect(result.transactionCount).toBe(2)
    expect(result.averagePerTransaction).toBe(400)
    expect(result.topCategories.length).toBeGreaterThan(0)
    expect(result.largestExpenses[0].amount).toBe(500)
    expect(Array.isArray(result.trends)).toBe(true)
  })
})

describe('local reports engine: crossover point', () => {
  it('detects when cumulative income crosses cumulative expenses (matches server)', async () => {
    const db = await freshDb()
    await seedReportFixture(db, false)

    const period = resolveLocalReportPeriod(JAN_2026_MONTHLY, TIMEZONE)
    const result = await computeLocalCrossoverPoint(db, period, TIMEZONE)

    expect(result.hasCrossover).toBe(true)
    expect(result.monthlyCrossoverPeriod).toBe('2026-01')
    expect(result.series.length).toBeGreaterThan(0)
  })
})

describe('local reports engine: net worth overview', () => {
  it('attaches a current-balances breakdown alongside the trend series', async () => {
    const db = await freshDb()
    await seedReportFixture(db, false)

    const result = await computeLocalNetWorthOverview(db, '2026-01-01', '2026-01-31', TIMEZONE)

    expect(result.balanceSource).toBe('accounts')
    expect(result.currentBalances.netWorth).toBe(5000)
    expect(result.series.length).toBeGreaterThan(0)
  })
})
