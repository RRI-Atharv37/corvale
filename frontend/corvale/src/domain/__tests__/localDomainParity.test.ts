import { describe, expect, it } from 'vitest'
import { MemorySqliteDriver } from '@platform/db/MemorySqliteDriver'
import { runMigrations } from '@platform/db/migrations/runMigrations'
import { MIGRATIONS } from '@platform/db/migrations/schema'
import { Repository } from '@platform/db/repositories/Repository'
import { setLocalUserPrefs } from '@platform/db/localUserPrefs'
import type { LocalDb } from '@platform/db/LocalDb'

import { recomputeLocalAccountBalance, recomputeAllLocalAccountBalances } from '../accountBalances'
import { computeLocalBudgetProgress, listLocalBudgetsWithProgress } from '../budgetProgress'
import { computeLocalSavingsGoalProgress } from '../savingsGoalProgress'
import { convertAmountWithRates, convertAmountLocal } from '../currency'
import {
  ruleMatchesTransactionLocal,
  applyLocalCategorizationRules,
  bulkApplyLocalCategorizationRules,
} from '../categorizationRules'
import {
  listLocalTransactions,
  filterLocalTransactions,
  searchLocalTransactions,
} from '../transactionSearch'
import {
  computeLocalCashFlowSeries,
  computeLocalCategoryBreakdown,
  computeLocalDashboardSummary,
  computeLocalNetWorthTrend,
  computeLocalBudgetOverview,
} from '../dashboard'

import type {
  LocalAccount,
  LocalBudget,
  LocalCategorizationRule,
  LocalCategory,
  LocalSavingsGoal,
  LocalSavingsGoalContribution,
  LocalTransaction,
} from '../types'

/**
 * Sprint 13.5 acceptance criteria: local computation over the local SQLite
 * store must match the server's computation (backend/tests/sharedDomainParity.test.ts)
 * for identical data. Every fixture and literal expected value below is
 * copied verbatim from that suite so this is a genuine cross-check, not a
 * tautological "call the same shared function twice" test.
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
const goalsRepo = new Repository<LocalSavingsGoal>('savingsGoals')
const contributionsRepo = new Repository<LocalSavingsGoalContribution>('savingsGoalContributions')
const rulesRepo = new Repository<LocalCategorizationRule>('categorizationRules')

let idCounter = 0
const nextId = (): string => {
  idCounter += 1
  return `id-${idCounter.toString().padStart(6, '0')}`
}

describe('local domain engine: account balances', () => {
  it('matches the server totalAccountBalance/liquidBalance fixture for checking/cash/credit/savings', async () => {
    const db = await freshDb()
    const accounts: LocalAccount[] = [
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1234.56, isArchived: false },
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', name: 'Cash', type: 'cash', currency: 'USD', currentBalance: 300.25, isArchived: false },
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', name: 'Credit Card', type: 'credit', currency: 'USD', currentBalance: 800.1, isArchived: false },
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', name: 'Savings', type: 'savings', currency: 'USD', currentBalance: 2000.75, isArchived: false },
    ]
    await accountsRepo.upsertFromServer(db, accounts)

    const summary = await computeLocalDashboardSummary(db, '2026-01-01', '2026-01-31', 'UTC')
    expect(summary.totalAccountBalance).toBe(2735.46)
    expect(summary.accountCount).toBe(4)
    expect(summary.balanceSource).toBe('accounts')
  })

  it('recomputes a checking account balance from posted transactions only, ignoring drafts (matches server: 1300)', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
    ])
    await transactionsRepo.upsertFromServer(db, [
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: 'c1', type: 'income', status: 'posted', amount: 50000, title: 'Paycheck', date: '2026-01-05T00:00:00.000Z', splitTransactionId: null },
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: 'c1', type: 'expense', status: 'posted', amount: 20000, title: 'Groceries', date: '2026-01-06T00:00:00.000Z', splitTransactionId: null },
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: 'c1', type: 'expense', status: 'draft', amount: 999900, title: 'Undecided', date: '2026-01-07T00:00:00.000Z', splitTransactionId: null },
    ])

    const balance = await recomputeLocalAccountBalance(db, accountId)
    expect(balance).toBe(1300)
  })

  it('recomputes a credit account balance with the sign flip applied (matches server: 70)', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Credit', type: 'credit', currency: 'USD', currentBalance: 0, isArchived: false },
    ])
    await transactionsRepo.upsertFromServer(db, [
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: 'c1', type: 'expense', status: 'posted', amount: 10000, title: 'Card purchase', date: '2026-02-01T00:00:00.000Z', splitTransactionId: null },
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: 'c1', type: 'income', status: 'posted', amount: 3000, title: 'Card payment', date: '2026-02-05T00:00:00.000Z', splitTransactionId: null },
    ])

    const balance = await recomputeLocalAccountBalance(db, accountId)
    expect(balance).toBe(70)
  })

  it('counts a split parent once and ignores its split children (matches server: 850)', async () => {
    const db = await freshDb()
    const accountId = nextId()
    const parentId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
    ])
    await transactionsRepo.upsertFromServer(db, [
      { _id: parentId, updatedAt: nowIso(), userId: 'u1', accountId, categoryId: 'c1', type: 'expense', status: 'posted', amount: 15000, title: 'Split trip', date: '2026-03-01T00:00:00.000Z', splitTransactionId: null },
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: 'c1', type: 'expense', status: 'posted', amount: 9000, title: 'Split trip', date: '2026-03-01T00:00:00.000Z', splitTransactionId: parentId },
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: 'c1', type: 'expense', status: 'posted', amount: 6000, title: 'Split trip', date: '2026-03-01T00:00:00.000Z', splitTransactionId: parentId },
    ])

    const balance = await recomputeLocalAccountBalance(db, accountId)
    expect(balance).toBe(850)
  })

  it('recomputes and persists every account balance in one pass after a pull', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
    ])
    await transactionsRepo.upsertFromServer(db, [
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: 'c1', type: 'income', status: 'posted', amount: 50000, title: 'Paycheck', date: '2026-01-05T00:00:00.000Z', splitTransactionId: null },
    ])

    const results = await recomputeAllLocalAccountBalances(db)
    expect(results.get(accountId)).toBe(1500)

    const persisted = await accountsRepo.findById(db, accountId)
    expect(persisted?.currentBalance).toBe(1500)
  })

  it('resolves a transfer pair by creation order: outbound leg withdraws, inbound leg deposits (Sprint 13.9)', async () => {
    const db = await freshDb()
    const fromId = nextId()
    const toId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: fromId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
      { _id: toId, updatedAt: nowIso(), userId: 'u1', name: 'Savings', type: 'savings', currency: 'USD', currentBalance: 500, isArchived: false },
    ])
    const outboundId = nextId()
    const inboundId = nextId()
    await transactionsRepo.upsertFromServer(db, [
      {
        _id: outboundId,
        updatedAt: nowIso(),
        createdAt: '2026-04-01T00:00:00.000Z',
        userId: 'u1',
        accountId: fromId,
        categoryId: 'c1',
        type: 'transfer',
        status: 'posted',
        amount: 20000,
        title: 'Transfer',
        date: '2026-04-01T00:00:00.000Z',
        splitTransactionId: null,
        transferPairId: inboundId,
      },
      {
        _id: inboundId,
        updatedAt: nowIso(),
        createdAt: '2026-04-01T00:00:00.001Z',
        userId: 'u1',
        accountId: toId,
        categoryId: 'c1',
        type: 'transfer',
        status: 'posted',
        amount: 20000,
        title: 'Transfer',
        date: '2026-04-01T00:00:00.000Z',
        splitTransactionId: null,
        transferPairId: outboundId,
      },
    ])

    expect(await recomputeLocalAccountBalance(db, fromId)).toBe(800)
    expect(await recomputeLocalAccountBalance(db, toId)).toBe(700)
  })
})

describe('local domain engine: budget progress', () => {
  it('computes budget spent identically to the server under the split-children rule (food=11000, transport=4000, overall=15000 minor)', async () => {
    const db = await freshDb()
    const accountId = nextId()
    const foodCategoryId = nextId()
    const transportCategoryId = nextId()
    const parentId = nextId()

    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 0, isArchived: false },
    ])

    await transactionsRepo.upsertFromServer(db, [
      { _id: parentId, updatedAt: nowIso(), userId: 'u1', accountId, categoryId: foodCategoryId, type: 'expense', status: 'posted', amount: 10000, title: 'Split trip', date: '2026-01-05T12:00:00.000Z', splitTransactionId: null },
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: foodCategoryId, type: 'expense', status: 'posted', amount: 6000, title: 'Split trip', date: '2026-01-05T12:00:00.000Z', splitTransactionId: parentId },
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: transportCategoryId, type: 'expense', status: 'posted', amount: 4000, title: 'Split trip', date: '2026-01-05T12:00:00.000Z', splitTransactionId: parentId },
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: foodCategoryId, type: 'expense', status: 'posted', amount: 5000, title: 'Regular food expense', date: '2026-01-08T12:00:00.000Z', splitTransactionId: null },
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: foodCategoryId, type: 'expense', status: 'draft', amount: 999900, title: 'Draft excluded', date: '2026-01-09T12:00:00.000Z', splitTransactionId: null },
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: foodCategoryId, type: 'transfer', status: 'posted', amount: 999900, title: 'Transfer excluded', date: '2026-01-10T12:00:00.000Z', splitTransactionId: null },
    ])

    const periodStart = '2026-01-01T00:00:00.000Z'
    const periodEnd = '2026-01-31T23:59:59.999Z'

    const foodBudgetId = nextId()
    const transportBudgetId = nextId()
    const overallBudgetId = nextId()

    await budgetsRepo.upsertFromServer(db, [
      { _id: foodBudgetId, updatedAt: nowIso(), userId: 'u1', categoryId: foodCategoryId, periodStart, periodEnd, amount: 100000, accountIds: [], isArchived: false },
      { _id: transportBudgetId, updatedAt: nowIso(), userId: 'u1', categoryId: transportCategoryId, periodStart, periodEnd, amount: 100000, accountIds: [], isArchived: false },
      { _id: overallBudgetId, updatedAt: nowIso(), userId: 'u1', categoryId: null, periodStart, periodEnd, amount: 1000000, accountIds: [], isArchived: false },
    ])

    const foodProgress = await computeLocalBudgetProgress(db, foodBudgetId)
    const transportProgress = await computeLocalBudgetProgress(db, transportBudgetId)
    const overallProgress = await computeLocalBudgetProgress(db, overallBudgetId)

    expect(foodProgress.spent).toBe(110)
    expect(transportProgress.spent).toBe(40)
    expect(overallProgress.spent).toBe(150)

    const withProgress = await listLocalBudgetsWithProgress(db)
    expect(withProgress.find((b) => b._id === foodBudgetId)?.progress.spent).toBe(110)
  })

  it('computes budget progress identically including the zero-budget edge case', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 0, isArchived: false },
    ])

    const budgetId = nextId()
    await budgetsRepo.upsertFromServer(db, [
      { _id: budgetId, updatedAt: nowIso(), userId: 'u1', categoryId: null, periodStart: '2026-01-01T00:00:00.000Z', periodEnd: '2026-01-31T23:59:59.999Z', amount: 0, accountIds: [], isArchived: false },
    ])
    await transactionsRepo.upsertFromServer(db, [
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: 'c1', type: 'expense', status: 'posted', amount: 500, title: 'x', date: '2026-01-05T00:00:00.000Z', splitTransactionId: null },
    ])

    const progress = await computeLocalBudgetProgress(db, budgetId)
    expect(progress.isOverBudget).toBe(true)
    expect(progress.percentUsed).toBe(0)
  })
})

describe('local domain engine: savings goal progress', () => {
  const NOW = new Date('2026-08-12T12:00:00.000Z')

  it('computes required monthly contribution identically for a goal with a target date (matches server: 187.5)', async () => {
    const db = await freshDb()
    const goalId = nextId()
    await goalsRepo.upsertFromServer(db, [
      {
        _id: goalId,
        updatedAt: nowIso(),
        userId: 'u1',
        name: 'Vacation',
        targetAmount: 100000,
        currentAmount: 25000,
        targetDate: '2026-12-31T23:59:59.999Z',
        status: 'active',
        autoContribution: { enabled: false, amount: 0, interval: 'monthly' },
      },
    ])

    const progress = await computeLocalSavingsGoalProgress(db, goalId, NOW)
    expect(progress.requiredMonthlyContribution).toBe(187.5)
  })

  it('projects completion date from the average of manual contributions when there is no target date (matches server: 2027-12-12)', async () => {
    const db = await freshDb()
    const goalId = nextId()
    await goalsRepo.upsertFromServer(db, [
      {
        _id: goalId,
        updatedAt: nowIso(),
        userId: 'u1',
        name: 'Rainy day fund',
        targetAmount: 50000,
        currentAmount: 10000,
        targetDate: null,
        status: 'active',
        autoContribution: { enabled: false, amount: 0, interval: 'monthly' },
      },
    ])
    await contributionsRepo.upsertFromServer(db, [
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', goalId, amount: 5000, contributedAt: '2026-05-01T00:00:00.000Z' },
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', goalId, amount: 5000, contributedAt: '2026-07-01T00:00:00.000Z' },
    ])

    const progress = await computeLocalSavingsGoalProgress(db, goalId, NOW)
    expect(progress.projectedCompletionDate).toBe('2027-12-12')
    expect(progress.requiredMonthlyContribution).toBeNull()
  })

  it('projects completion date identically when auto-contribution is enabled (matches server: 2026-11-12)', async () => {
    const db = await freshDb()
    const goalId = nextId()
    await goalsRepo.upsertFromServer(db, [
      {
        _id: goalId,
        updatedAt: nowIso(),
        userId: 'u1',
        name: 'Test projection',
        targetAmount: 100000,
        currentAmount: 25000,
        targetDate: null,
        status: 'active',
        autoContribution: { enabled: true, amount: 25000, interval: 'monthly' },
      },
    ])

    const progress = await computeLocalSavingsGoalProgress(db, goalId, NOW)
    expect(progress.projectedCompletionDate).toBe('2026-11-12')
  })
})

describe('local domain engine: currency conversion', () => {
  it('converts a direct pair, an inverse pair, and falls back to 1:1 when unconfigured (matches server)', () => {
    const rates = { EUR_USD: 1.25, GBP_USD: 1.5 }

    const direct = convertAmountWithRates(100, 'EUR', 'USD', rates)
    expect(direct.convertedAmount).toBe(125)
    expect(direct.rateConfigured).toBe(true)

    const inverse = convertAmountWithRates(100, 'USD', 'GBP', rates)
    expect(inverse.rateConfigured).toBe(true)
    expect(inverse.convertedAmount).toBeCloseTo(66.666, 2)

    const fallback = convertAmountWithRates(50, 'JPY', 'USD', rates)
    expect(fallback.convertedAmount).toBe(50)
    expect(fallback.rateConfigured).toBe(false)
  })

  it('reads exchange rates from the cached local user prefs', async () => {
    const db = await freshDb()
    await setLocalUserPrefs(db, { preferredCurrency: 'USD', exchangeRates: { EUR_USD: 1.25 }, timezone: 'UTC' })

    const result = await convertAmountLocal(db, 100, 'EUR', 'USD')
    expect(result.convertedAmount).toBe(125)
    expect(result.rateConfigured).toBe(true)
  })
})

describe('local domain engine: categorization rules', () => {
  it('matches transactions against every rule type identically to the server matrix', () => {
    const matchedAccountId = 'acc-matched'
    const otherAccountId = 'acc-other'
    const categoryId = 'cat-1'

    const rules: LocalCategorizationRule[] = [
      { _id: 'r1', updatedAt: nowIso(), userId: 'u1', name: 'Coffee rule', matchType: 'description_contains', matchValue: 'coffee', categoryId, priority: 0, isActive: true },
      { _id: 'r2', updatedAt: nowIso(), userId: 'u1', name: 'Rent rule', matchType: 'description_equals', matchValue: 'rent', categoryId, priority: 0, isActive: true },
      { _id: 'r3', updatedAt: nowIso(), userId: 'u1', name: 'Range rule', matchType: 'amount_range', amountMin: 5000, amountMax: 20000, categoryId, priority: 0, isActive: true },
      { _id: 'r4', updatedAt: nowIso(), userId: 'u1', name: 'Account rule', matchType: 'account_id', accountId: matchedAccountId, categoryId, priority: 0, isActive: true },
      { _id: 'r5', updatedAt: nowIso(), userId: 'u1', name: 'Inactive rule', matchType: 'description_contains', matchValue: 'coffee', categoryId, priority: 0, isActive: false },
    ]

    const inputs = [
      { title: 'Morning Coffee', description: '', amount: 500, accountId: otherAccountId, type: 'expense' },
      { title: 'Rent', description: '', amount: 150000, accountId: otherAccountId, type: 'expense' },
      { title: 'Random purchase', description: '', amount: 10000, accountId: otherAccountId, type: 'expense' },
      { title: 'Random purchase', description: '', amount: 10000, accountId: matchedAccountId, type: 'expense' },
      { title: 'Coffee transfer', description: '', amount: 500, accountId: otherAccountId, type: 'transfer' },
    ] as const

    const expected = [
      [true, false, false, false, false],
      [false, true, false, false, false],
      [false, false, true, true, false],
      [false, false, false, true, false],
      [false, false, false, false, false],
    ]

    rules.forEach((rule, ruleIndex) => {
      inputs.forEach((input, inputIndex) => {
        expect(ruleMatchesTransactionLocal(rule, input)).toBe(expected[ruleIndex][inputIndex])
      })
    })
  })

  it('applies the first matching active rule by priority on transaction create', async () => {
    const db = await freshDb()
    const categoryId = nextId()
    await rulesRepo.upsertFromServer(db, [
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', name: 'Low priority', matchType: 'description_contains', matchValue: 'coffee', categoryId: 'wrong-cat', tags: ['low'], priority: 1, isActive: true },
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', name: 'High priority', matchType: 'description_contains', matchValue: 'coffee', categoryId, tags: ['high'], priority: 10, isActive: true },
    ])

    const result = await applyLocalCategorizationRules(db, {
      title: 'Morning coffee run',
      description: '',
      amount: 450,
      accountId: 'acc-1',
      type: 'expense',
    })

    expect(result?.categoryId).toBe(categoryId)
    expect(result?.tags).toEqual(['high'])
  })

  it('bulk-applies rules to existing transactions, skipping ones that already match', async () => {
    const db = await freshDb()
    const accountId = nextId()
    const coffeeCategoryId = nextId()
    const otherCategoryId = nextId()

    await rulesRepo.upsertFromServer(db, [
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', name: 'Coffee rule', matchType: 'description_contains', matchValue: 'coffee', categoryId: coffeeCategoryId, priority: 0, isActive: true },
    ])

    const txNeedsUpdate = nextId()
    const txAlreadyMatches = nextId()
    const txNoMatch = nextId()

    await transactionsRepo.upsertFromServer(db, [
      { _id: txNeedsUpdate, updatedAt: nowIso(), userId: 'u1', accountId, categoryId: otherCategoryId, type: 'expense', status: 'posted', amount: 500, title: 'Coffee run', date: '2026-01-01T00:00:00.000Z', splitTransactionId: null },
      { _id: txAlreadyMatches, updatedAt: nowIso(), userId: 'u1', accountId, categoryId: coffeeCategoryId, type: 'expense', status: 'posted', amount: 500, title: 'Coffee run', date: '2026-01-01T00:00:00.000Z', splitTransactionId: null },
      { _id: txNoMatch, updatedAt: nowIso(), userId: 'u1', accountId, categoryId: otherCategoryId, type: 'expense', status: 'posted', amount: 500, title: 'Groceries', date: '2026-01-01T00:00:00.000Z', splitTransactionId: null },
    ])

    const result = await bulkApplyLocalCategorizationRules(db)
    expect(result.updated).toBe(1)
    expect(result.skipped).toBe(2)

    const updated = await transactionsRepo.findById(db, txNeedsUpdate)
    expect(updated?.categoryId).toBe(coffeeCategoryId)
  })
})

describe('local domain engine: transaction search and filter', () => {
  const setupTransactions = async (db: LocalDb) => {
    const accountId = nextId()
    const otherAccountId = nextId()
    const parentId = nextId()

    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 0, isArchived: false },
    ])

    await transactionsRepo.upsertFromServer(db, [
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: 'c1', type: 'expense', status: 'posted', amount: 1500, title: 'Coffee shop', description: 'morning brew', date: '2026-01-05T00:00:00.000Z', clearedStatus: 'cleared', tags: ['dining'], splitTransactionId: null },
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: 'c2', type: 'income', status: 'posted', amount: 200000, title: 'Paycheck', date: '2026-01-10T00:00:00.000Z', clearedStatus: 'pending', tags: [], splitTransactionId: null },
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId: otherAccountId, categoryId: 'c1', type: 'expense', status: 'posted', amount: 3000, title: 'Groceries', date: '2026-02-01T00:00:00.000Z', clearedStatus: 'cleared', tags: ['essentials'], splitTransactionId: null },
      { _id: parentId, updatedAt: nowIso(), userId: 'u1', accountId, categoryId: 'c1', type: 'expense', status: 'posted', amount: 9000, title: 'Split parent (kept)', date: '2026-01-06T00:00:00.000Z', splitTransactionId: null },
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: 'c1', type: 'expense', status: 'posted', amount: 9000, title: 'Split child (excluded)', date: '2026-01-06T00:00:00.000Z', splitTransactionId: parentId },
    ])

    return { accountId, otherAccountId }
  }

  it('excludes split children but keeps split parents in list results, mirroring the server LISTABLE_TRANSACTION_FILTER', async () => {
    const db = await freshDb()
    const { accountId } = await setupTransactions(db)

    const all = await listLocalTransactions(db)
    expect(all.find((tx) => tx.title === 'Split parent (kept)')).toBeDefined()
    expect(all.find((tx) => tx.title === 'Split child (excluded)')).toBeUndefined()

    const forAccount = await listLocalTransactions(db, { accountId })
    expect(forAccount.every((tx) => tx.accountId === accountId)).toBe(true)
  })

  it('filters by type, clearedStatus and tags', async () => {
    const db = await freshDb()
    await setupTransactions(db)

    const expenses = await listLocalTransactions(db, { type: 'expense' })
    expect(expenses.every((tx) => tx.type === 'expense')).toBe(true)

    const cleared = await listLocalTransactions(db, { clearedStatus: 'cleared' })
    expect(cleared.every((tx) => tx.clearedStatus === 'cleared')).toBe(true)

    const dining = await listLocalTransactions(db, { tags: ['dining'] })
    expect(dining).toHaveLength(1)
    expect(dining[0].title).toBe('Coffee shop')
  })

  it('filters by a required date range', async () => {
    const db = await freshDb()
    await setupTransactions(db)

    const januaryOnly = await filterLocalTransactions(db, '2026-01-01', '2026-01-31', 'UTC')
    expect(januaryOnly.every((tx) => tx.date.startsWith('2026-01'))).toBe(true)
    expect(januaryOnly.find((tx) => tx.title === 'Groceries')).toBeUndefined()
  })

  it('searches by keyword across title/description/tags, and by exact numeric amount', async () => {
    const db = await freshDb()
    await setupTransactions(db)

    const byDescription = await searchLocalTransactions(db, 'brew')
    expect(byDescription).toHaveLength(1)
    expect(byDescription[0].title).toBe('Coffee shop')

    const byTag = await searchLocalTransactions(db, 'essentials')
    expect(byTag).toHaveLength(1)
    expect(byTag[0].title).toBe('Groceries')

    const byAmount = await searchLocalTransactions(db, '2000')
    expect(byAmount).toHaveLength(1)
    expect(byAmount[0].title).toBe('Paycheck')
  })

  it('sorts by amount and by date with direction', async () => {
    const db = await freshDb()
    await setupTransactions(db)

    const byAmountAsc = await listLocalTransactions(db, {}, 'amount', 'asc')
    for (let i = 1; i < byAmountAsc.length; i += 1) {
      expect(byAmountAsc[i].amount).toBeGreaterThanOrEqual(byAmountAsc[i - 1].amount)
    }
  })
})

describe('local domain engine: dashboard aggregates', () => {
  const setupDashboardFixture = async (db: LocalDb) => {
    const accountId = nextId()
    const foodCategoryId = nextId()
    const foodSubCategoryId = nextId()
    const incomeCategoryId = nextId()

    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
    ])
    await categoriesRepo.upsertFromServer(db, [
      { _id: foodCategoryId, updatedAt: nowIso(), userId: 'u1', masterCategoryId: null, name: 'Food', isArchived: false },
      { _id: foodSubCategoryId, updatedAt: nowIso(), userId: 'u1', masterCategoryId: foodCategoryId, name: 'Restaurants', isArchived: false },
      { _id: incomeCategoryId, updatedAt: nowIso(), userId: 'u1', masterCategoryId: null, name: 'Salary', isArchived: false },
    ])
    await transactionsRepo.upsertFromServer(db, [
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: incomeCategoryId, type: 'income', status: 'posted', amount: 300000, title: 'Paycheck', date: '2026-01-05T00:00:00.000Z', splitTransactionId: null },
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: foodCategoryId, type: 'expense', status: 'posted', amount: 5000, title: 'Groceries', date: '2026-01-06T00:00:00.000Z', splitTransactionId: null },
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: foodSubCategoryId, type: 'expense', status: 'posted', amount: 3000, title: 'Dinner out', date: '2026-01-15T00:00:00.000Z', splitTransactionId: null },
    ])

    return { accountId, foodCategoryId }
  }

  it('computes a cash flow series grouped by month', async () => {
    const db = await freshDb()
    await setupDashboardFixture(db)

    const series = await computeLocalCashFlowSeries(db, '2026-01-01', '2026-01-31', 'month', 'UTC')
    expect(series).toEqual([{ period: '2026-01', income: 3000, expense: 80, net: 2920 }])
  })

  it('rolls sub-category spend up into its master category for the breakdown', async () => {
    const db = await freshDb()
    const { foodCategoryId } = await setupDashboardFixture(db)

    const breakdown = await computeLocalCategoryBreakdown(db, '2026-01-01', '2026-01-31', 'expense', 'UTC')
    const food = breakdown.find((item) => item.categoryId === foodCategoryId)
    expect(food?.amount).toBe(80)
  })

  it('computes a dashboard summary consistent with the cash flow totals', async () => {
    const db = await freshDb()
    await setupDashboardFixture(db)

    const summary = await computeLocalDashboardSummary(db, '2026-01-01', '2026-01-31', 'UTC')
    expect(summary.totalIncome).toBe(3000)
    expect(summary.totalExpenses).toBe(80)
    expect(summary.netSavings).toBe(2920)
    expect(summary.balanceSource).toBe('accounts')
  })

  it('computes a net worth trend series anchored to current account balances', async () => {
    const db = await freshDb()
    await setupDashboardFixture(db)

    const trend = await computeLocalNetWorthTrend(db, '2026-01-01', '2026-01-31', 'UTC')
    expect(trend.series).toHaveLength(1)
    expect(trend.series[0].netWorth).toBe(1000)
    expect(trend.balanceSource).toBe('accounts')
  })

  it('computes a budget overview for the current month with attached category names', async () => {
    const db = await freshDb()
    const { foodCategoryId } = await setupDashboardFixture(db)

    const now = new Date()
    const year = now.getUTCFullYear()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    const periodStart = `${year}-${month}-01T00:00:00.000Z`
    const periodEnd = `${year}-${month}-28T23:59:59.999Z`

    await budgetsRepo.upsertFromServer(db, [
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', name: 'Food budget', categoryId: foodCategoryId, periodStart, periodEnd, amount: 100000, accountIds: [], isArchived: false },
    ])

    const overview = await computeLocalBudgetOverview(db, 'UTC')
    expect(overview.budgets).toHaveLength(1)
    expect(overview.budgets[0].categoryName).toBe('Food')
  })
})
