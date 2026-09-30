import { describe, expect, it } from 'vitest'
import { MemorySqliteDriver } from '@platform/db/MemorySqliteDriver'
import { runMigrations } from '@platform/db/migrations/runMigrations'
import { MIGRATIONS } from '@platform/db/migrations/schema'
import { Repository } from '@platform/db/repositories/Repository'
import type { LocalDb } from '@platform/db/LocalDb'

import { computeLocalBudgetProgress, listLocalBudgetsWithProgress } from '../budgetProgress'
import {
  computeLocalBudgetOverview,
  computeLocalCashFlowSeries,
  computeLocalCategoryBreakdown,
  computeLocalDashboardSummary,
  computeLocalNetWorthTrend,
} from '../dashboard'
import {
  computeLocalBudgetAnalysis,
  computeLocalIncomeVsExpense,
  computeLocalLargestExpenses,
  computeLocalNetWorthOverview,
  computeLocalPeriodAverages,
  computeLocalRecurringTotals,
  computeLocalSavingsRate,
  computeLocalSpendingAnalysis,
  resolveLocalReportPeriod,
} from '../reports'
import type {
  LocalAccount,
  LocalBudget,
  LocalCategory,
  LocalRecurringRule,
  LocalTransaction,
} from '../types'

/**
 * BUG-73 (S55): the local store holds personal and shared-workspace rows side by side, so every
 * aggregate takes the active scope. The server is personal-only unless a workspace is passed
 * (`dashboardUtils` / `reportUtils` build `buildScopedListFilter(userId, workspaceId)`), so a scope
 * argument must make the local numbers equal what the server returns for that scope. Omitting it
 * means personal, the same default the forecast, calendar and subscriptions engines already use.
 */

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

const WS = 'ws-1'

interface Fixture {
  personalAccountId: string
  workspaceAccountId: string
  foodCategoryId: string
  personalBudgetId: string
  workspaceBudgetId: string
}

/**
 * Personal:  checking 1000.00, income 3000.00, food expense 50.00, recurring 10.00/month.
 * Workspace: checking 9000.00, income 8000.00, food expense 400.00, recurring 70.00/month.
 */
const seed = async (db: LocalDb): Promise<Fixture> => {
  const personalAccountId = 'acc-personal'
  const workspaceAccountId = 'acc-workspace'
  const foodCategoryId = 'cat-food'
  const incomeCategoryId = 'cat-income'
  const personalBudgetId = 'bud-personal'
  const workspaceBudgetId = 'bud-workspace'

  await accountsRepo.upsertFromServer(db, [
    { _id: personalAccountId, updatedAt: nowIso(), userId: 'u1', workspaceId: null, name: 'Personal', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
    { _id: workspaceAccountId, updatedAt: nowIso(), userId: 'u2', workspaceId: WS, name: 'Shared', type: 'checking', currency: 'USD', currentBalance: 9000, isArchived: false },
  ])
  await categoriesRepo.upsertFromServer(db, [
    { _id: foodCategoryId, updatedAt: nowIso(), userId: 'u1', masterCategoryId: null, name: 'Food', isArchived: false },
    { _id: incomeCategoryId, updatedAt: nowIso(), userId: 'u1', masterCategoryId: null, name: 'Salary', isArchived: false },
  ])
  await transactionsRepo.upsertFromServer(db, [
    { _id: 'tx-p-income', updatedAt: nowIso(), userId: 'u1', workspaceId: null, accountId: personalAccountId, categoryId: incomeCategoryId, type: 'income', status: 'posted', amount: 300000, title: 'Paycheck', date: '2026-01-05T00:00:00.000Z', splitTransactionId: null },
    { _id: 'tx-p-food', updatedAt: nowIso(), userId: 'u1', workspaceId: null, accountId: personalAccountId, categoryId: foodCategoryId, type: 'expense', status: 'posted', amount: 5000, title: 'Groceries', date: '2026-01-06T00:00:00.000Z', splitTransactionId: null },
    { _id: 'tx-p-rec', updatedAt: nowIso(), userId: 'u1', workspaceId: null, accountId: personalAccountId, categoryId: foodCategoryId, type: 'expense', status: 'posted', amount: 1000, title: 'Streaming', date: '2026-01-07T00:00:00.000Z', splitTransactionId: null, recurringPaymentId: 'rule-personal' } as LocalTransaction,
    { _id: 'tx-w-income', updatedAt: nowIso(), userId: 'u2', workspaceId: WS, accountId: workspaceAccountId, categoryId: incomeCategoryId, type: 'income', status: 'posted', amount: 800000, title: 'Shared income', date: '2026-01-05T00:00:00.000Z', splitTransactionId: null },
    { _id: 'tx-w-food', updatedAt: nowIso(), userId: 'u2', workspaceId: WS, accountId: workspaceAccountId, categoryId: foodCategoryId, type: 'expense', status: 'posted', amount: 40000, title: 'Team lunch', date: '2026-01-06T00:00:00.000Z', splitTransactionId: null },
    { _id: 'tx-w-rec', updatedAt: nowIso(), userId: 'u2', workspaceId: WS, accountId: workspaceAccountId, categoryId: foodCategoryId, type: 'expense', status: 'posted', amount: 7000, title: 'Shared subscription', date: '2026-01-07T00:00:00.000Z', splitTransactionId: null, recurringPaymentId: 'rule-workspace' } as LocalTransaction,
  ])

  const periodStart = '2026-01-01T00:00:00.000Z'
  const periodEnd = '2026-01-31T23:59:59.999Z'
  await budgetsRepo.upsertFromServer(db, [
    { _id: personalBudgetId, updatedAt: nowIso(), userId: 'u1', workspaceId: null, name: 'Personal overall', categoryId: null, periodStart, periodEnd, amount: 100000, accountIds: [], isArchived: false },
    { _id: workspaceBudgetId, updatedAt: nowIso(), userId: 'u2', workspaceId: WS, name: 'Shared overall', categoryId: null, periodStart, periodEnd, amount: 500000, accountIds: [], isArchived: false },
  ])
  await rulesRepo.upsertFromServer(db, [
    { _id: 'rule-personal', updatedAt: nowIso(), userId: 'u1', workspaceId: null, title: 'Streaming', type: 'expense', amount: 1000, currency: 'USD', accountId: personalAccountId, categoryId: foodCategoryId, interval: 'monthly', nextDueDate: '2026-02-07T00:00:00.000Z', isActive: true, isArchived: false, isCancelled: false },
    { _id: 'rule-workspace', updatedAt: nowIso(), userId: 'u2', workspaceId: WS, title: 'Shared subscription', type: 'expense', amount: 7000, currency: 'USD', accountId: workspaceAccountId, categoryId: foodCategoryId, interval: 'monthly', nextDueDate: '2026-02-07T00:00:00.000Z', isActive: true, isArchived: false, isCancelled: false },
  ])

  return { personalAccountId, workspaceAccountId, foodCategoryId, personalBudgetId, workspaceBudgetId }
}

const period = () => resolveLocalReportPeriod({ periodType: 'custom', startDate: '2026-01-01', endDate: '2026-01-31' }, 'UTC')

describe('local dashboard aggregates respect the active scope (BUG-73)', () => {
  it('summary: personal totals exclude workspace money; workspace scope shows only the shared rows', async () => {
    const db = await freshDb()
    await seed(db)

    const personal = await computeLocalDashboardSummary(db, '2026-01-01', '2026-01-31', 'UTC')
    expect(personal.totalIncome).toBe(3000)
    expect(personal.totalExpenses).toBe(60)
    expect(personal.totalAccountBalance).toBe(1000)
    expect(personal.accountCount).toBe(1)

    const shared = await computeLocalDashboardSummary(db, '2026-01-01', '2026-01-31', 'UTC', undefined, { workspaceId: WS })
    expect(shared.totalIncome).toBe(8000)
    expect(shared.totalExpenses).toBe(470)
    expect(shared.totalAccountBalance).toBe(9000)
    expect(shared.accountCount).toBe(1)
  })

  it('cash flow series and category breakdown are scoped', async () => {
    const db = await freshDb()
    const { foodCategoryId } = await seed(db)

    expect(await computeLocalCashFlowSeries(db, '2026-01-01', '2026-01-31', 'month', 'UTC')).toEqual([
      { period: '2026-01', income: 3000, expense: 60, net: 2940 },
    ])
    expect(
      await computeLocalCashFlowSeries(db, '2026-01-01', '2026-01-31', 'month', 'UTC', { workspaceId: WS })
    ).toEqual([{ period: '2026-01', income: 8000, expense: 470, net: 7530 }])

    const personalFood = (await computeLocalCategoryBreakdown(db, '2026-01-01', '2026-01-31', 'expense', 'UTC')).find(
      (item) => item.categoryId === foodCategoryId
    )
    expect(personalFood?.amount).toBe(60)
    const sharedFood = (
      await computeLocalCategoryBreakdown(db, '2026-01-01', '2026-01-31', 'expense', 'UTC', { workspaceId: WS })
    ).find((item) => item.categoryId === foodCategoryId)
    expect(sharedFood?.amount).toBe(470)
  })

  it('net worth trend is anchored to the active scope\'s accounts only', async () => {
    const db = await freshDb()
    await seed(db)

    expect((await computeLocalNetWorthTrend(db, '2026-01-01', '2026-01-31', 'UTC')).series[0].netWorth).toBe(1000)
    expect(
      (await computeLocalNetWorthTrend(db, '2026-01-01', '2026-01-31', 'UTC', undefined, { workspaceId: WS })).series[0]
        .netWorth
    ).toBe(9000)
  })

  it('budget overview lists only the active scope\'s budgets, with spend from that scope alone', async () => {
    const db = await freshDb()
    await seed(db)
    const now = new Date()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    const currentStart = `${now.getUTCFullYear()}-${month}-01T00:00:00.000Z`
    const currentEnd = `${now.getUTCFullYear()}-${month}-28T23:59:59.999Z`
    await budgetsRepo.upsertFromServer(db, [
      { _id: 'bud-p-now', updatedAt: nowIso(), userId: 'u1', workspaceId: null, name: 'P now', categoryId: null, periodStart: currentStart, periodEnd: currentEnd, amount: 1000, accountIds: [], isArchived: false },
      { _id: 'bud-w-now', updatedAt: nowIso(), userId: 'u2', workspaceId: WS, name: 'W now', categoryId: null, periodStart: currentStart, periodEnd: currentEnd, amount: 1000, accountIds: [], isArchived: false },
    ])

    expect((await computeLocalBudgetOverview(db, 'UTC')).budgets.map((b) => b.budgetId)).toEqual(['bud-p-now'])
    expect((await computeLocalBudgetOverview(db, 'UTC', { workspaceId: WS })).budgets.map((b) => b.budgetId)).toEqual([
      'bud-w-now',
    ])
  })
})

describe('local budgets respect the active scope (BUG-73)', () => {
  it('listLocalBudgetsWithProgress returns only the active scope and counts only its transactions', async () => {
    const db = await freshDb()
    const { personalBudgetId, workspaceBudgetId } = await seed(db)

    const personal = await listLocalBudgetsWithProgress(db)
    expect(personal.map((b) => b._id)).toEqual([personalBudgetId])
    expect(personal[0].progress.spent).toBe(60)

    const shared = await listLocalBudgetsWithProgress(db, { workspaceId: WS })
    expect(shared.map((b) => b._id)).toEqual([workspaceBudgetId])
    expect(shared[0].progress.spent).toBe(470)
  })

  it('a personal overall budget does not count the shared account\'s expenses', async () => {
    const db = await freshDb()
    const { personalBudgetId, workspaceBudgetId } = await seed(db)

    expect((await computeLocalBudgetProgress(db, personalBudgetId)).spent).toBe(60)
    expect((await computeLocalBudgetProgress(db, workspaceBudgetId)).spent).toBe(470)
  })
})

describe('local reports respect the active scope and match the server numbers (BUG-73)', () => {
  it('period averages, income vs expense and savings rate', async () => {
    const db = await freshDb()
    await seed(db)

    const averages = await computeLocalPeriodAverages(db, period(), 'UTC')
    expect(averages.totalIncome).toBe(3000)
    expect(averages.totalExpenses).toBe(60)

    const sharedAverages = await computeLocalPeriodAverages(db, period(), 'UTC', { workspaceId: WS })
    expect(sharedAverages.totalIncome).toBe(8000)
    expect(sharedAverages.totalExpenses).toBe(470)

    const vs = await computeLocalIncomeVsExpense(db, period())
    expect([vs.totalIncome, vs.totalExpenses]).toEqual([3000, 60])
    const sharedVs = await computeLocalIncomeVsExpense(db, period(), { workspaceId: WS })
    expect([sharedVs.totalIncome, sharedVs.totalExpenses]).toEqual([8000, 470])

    const rate = await computeLocalSavingsRate(db, period())
    expect(rate.netSavings).toBe(2940)
    const sharedRate = await computeLocalSavingsRate(db, period(), { workspaceId: WS })
    expect(sharedRate.netSavings).toBe(7530)
  })

  it('largest expenses and spending analysis', async () => {
    const db = await freshDb()
    await seed(db)

    const largest = await computeLocalLargestExpenses(db, period(), 10)
    expect(largest.expenses.map((e) => e.transactionId).sort()).toEqual(['tx-p-food', 'tx-p-rec'])
    const sharedLargest = await computeLocalLargestExpenses(db, period(), 10, { workspaceId: WS })
    expect(sharedLargest.expenses.map((e) => e.transactionId)).toEqual(['tx-w-food', 'tx-w-rec'])

    const analysis = await computeLocalSpendingAnalysis(db, period(), 'UTC', 10)
    expect(analysis.transactionCount).toBe(2)
    expect(analysis.totalExpenses).toBe(60)
    const sharedAnalysis = await computeLocalSpendingAnalysis(db, period(), 'UTC', 10, { workspaceId: WS })
    expect(sharedAnalysis.transactionCount).toBe(2)
    expect(sharedAnalysis.totalExpenses).toBe(470)
  })

  it('recurring totals count only the active scope\'s rules and posted recurring expenses', async () => {
    const db = await freshDb()
    await seed(db)

    const personal = await computeLocalRecurringTotals(db, period())
    expect(personal.activeExpenseRules.map((r) => r.ruleId)).toEqual(['rule-personal'])
    expect(personal.totalMonthlyEquivalent).toBe(10)
    expect(personal.postedRecurringExpensesInPeriod).toBe(10)

    const shared = await computeLocalRecurringTotals(db, period(), { workspaceId: WS })
    expect(shared.activeExpenseRules.map((r) => r.ruleId)).toEqual(['rule-workspace'])
    expect(shared.totalMonthlyEquivalent).toBe(70)
    expect(shared.postedRecurringExpensesInPeriod).toBe(70)
  })

  it('budget analysis lists only the active scope\'s budgets', async () => {
    const db = await freshDb()
    const { personalBudgetId, workspaceBudgetId } = await seed(db)

    const personal = await computeLocalBudgetAnalysis(db, period())
    expect(personal.budgets.map((b) => b.budgetId)).toEqual([personalBudgetId])
    expect(personal.totalSpent).toBe(60)

    const shared = await computeLocalBudgetAnalysis(db, period(), { workspaceId: WS })
    expect(shared.budgets.map((b) => b.budgetId)).toEqual([workspaceBudgetId])
    expect(shared.totalSpent).toBe(470)
  })

  it('net worth overview balances come from the active scope\'s accounts', async () => {
    const db = await freshDb()
    await seed(db)

    const personal = await computeLocalNetWorthOverview(db, '2026-01-01', '2026-01-31', 'UTC')
    expect(personal.currentBalances.liquid).toBe(1000)
    const shared = await computeLocalNetWorthOverview(db, '2026-01-01', '2026-01-31', 'UTC', undefined, {
      workspaceId: WS,
    })
    expect(shared.currentBalances.liquid).toBe(9000)
  })
})
