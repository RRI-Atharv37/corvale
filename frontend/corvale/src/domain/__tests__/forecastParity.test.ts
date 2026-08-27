import { describe, expect, it } from 'vitest'
import { MemorySqliteDriver } from '../../db/MemorySqliteDriver'
import { runMigrations } from '../../db/migrations/runMigrations'
import { MIGRATIONS } from '../../db/migrations/schema'
import { Repository } from '../../db/repositories/Repository'
import type { LocalDb } from '../../db/LocalDb'

import { computeLocalForecast } from '../forecast'
import type { LocalAccount, LocalRecurringRule, LocalSavingsGoal, LocalTransaction } from '../types'

/**
 * Sprint 13.10 acceptance criteria for the local cash flow forecast: local computation over the
 * local SQLite store must match the server's `GET /forecast` (backend/tests/forecast.test.ts,
 * backend/controllers/forecastController.ts) for identical data. Fixture values and expected
 * numbers below are copied from that suite so this is a genuine cross-check.
 */

const freshDb = async (): Promise<LocalDb> => {
  const db = await MemorySqliteDriver.create()
  await runMigrations(db, MIGRATIONS)
  return db
}

const nowIso = () => new Date().toISOString()

const accountsRepo = new Repository<LocalAccount>('accounts')
const recurringRepo = new Repository<LocalRecurringRule>('recurringRules')
const goalsRepo = new Repository<LocalSavingsGoal & { accountId?: string | null }>('savingsGoals')
const transactionsRepo = new Repository<LocalTransaction>('transactions')

let idCounter = 0
const nextId = (): string => {
  idCounter += 1
  return `id-${idCounter.toString().padStart(6, '0')}`
}

const daysFromNowStr = (offset: number): string => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

const daysFromNowIso = (offset: number): string => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString()
}

describe('local forecast: no activity', () => {
  it('projects a flat balance when there are no recurring rules or goals (matches server: 500/500, no changes)', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 500, isArchived: false },
    ])

    const forecast = await computeLocalForecast(db, { days: 30 })
    const projected = forecast.accounts.find((a) => a.accountId === accountId)

    expect(projected?.startingBalance).toBe(500)
    expect(projected?.projectedEndingBalance).toBe(500)
    expect(projected?.projectedChanges).toHaveLength(0)
    expect(projected?.lowBalanceWarnings).toHaveLength(0)
  })

  it('returns an empty accounts array when the user has no accounts', async () => {
    const db = await freshDb()
    const forecast = await computeLocalForecast(db, { days: 30 })
    expect(forecast.accounts).toHaveLength(0)
  })
})

describe('local forecast: recurring rule projection', () => {
  it('includes a single occurrence of a monthly expense rule due within the window (matches server: -200, ending 800)', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
    ])
    await recurringRepo.upsertFromServer(db, [
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', title: 'Rent', type: 'expense', amount: 20000, currency: 'USD',
        accountId, categoryId: 'c1', interval: 'monthly', nextDueDate: daysFromNowIso(10),
        isActive: true, isArchived: false, isCancelled: false,
      },
    ])

    const forecast = await computeLocalForecast(db, { days: 30 })
    const projected = forecast.accounts.find((a) => a.accountId === accountId)
    const recurringChanges = projected?.projectedChanges.filter((c) => c.type === 'recurring') ?? []

    expect(recurringChanges).toHaveLength(1)
    expect(recurringChanges[0].amount).toBe(-200)
    expect(recurringChanges[0].date).toBe(daysFromNowStr(10))
    expect(projected?.projectedEndingBalance).toBe(800)
  })

  it('includes multiple occurrences of a weekly income rule within a 30-day window (matches server: >=4 occurrences)', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
    ])
    await recurringRepo.upsertFromServer(db, [
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', title: 'Freelance income', type: 'income', amount: 5000, currency: 'USD',
        accountId, categoryId: 'c1', interval: 'weekly', nextDueDate: daysFromNowIso(1),
        isActive: true, isArchived: false, isCancelled: false,
      },
    ])

    const forecast = await computeLocalForecast(db, { days: 30 })
    const projected = forecast.accounts.find((a) => a.accountId === accountId)
    const recurringChanges = projected?.projectedChanges.filter((c) => c.type === 'recurring') ?? []

    expect(recurringChanges.length).toBeGreaterThanOrEqual(4)
    expect(recurringChanges.every((c) => c.amount === 50)).toBe(true)
    expect(projected?.projectedEndingBalance).toBe(1000 + recurringChanges.length * 50)
  })

  it('excludes inactive and archived recurring rules from the projection (matches server: no changes, ending 1000)', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
    ])
    await recurringRepo.upsertFromServer(db, [
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', title: 'Paused bill', type: 'expense', amount: 10000, currency: 'USD',
        accountId, categoryId: 'c1', interval: 'monthly', nextDueDate: daysFromNowIso(5),
        isActive: false, isArchived: false, isCancelled: false,
      },
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', title: 'Cancelled bill', type: 'expense', amount: 10000, currency: 'USD',
        accountId, categoryId: 'c1', interval: 'monthly', nextDueDate: daysFromNowIso(6),
        isActive: true, isArchived: true, isCancelled: false,
      },
    ])

    const forecast = await computeLocalForecast(db, { days: 30 })
    const projected = forecast.accounts.find((a) => a.accountId === accountId)

    expect(projected?.projectedChanges.filter((c) => c.type === 'recurring')).toHaveLength(0)
    expect(projected?.projectedEndingBalance).toBe(1000)
  })

  it('excludes occurrences that fall outside the requested window (matches server: ending 1000)', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
    ])
    await recurringRepo.upsertFromServer(db, [
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', title: 'Far future bill', type: 'expense', amount: 10000, currency: 'USD',
        accountId, categoryId: 'c1', interval: 'monthly', nextDueDate: daysFromNowIso(45),
        isActive: true, isArchived: false, isCancelled: false,
      },
    ])

    const forecast = await computeLocalForecast(db, { days: 30 })
    const projected = forecast.accounts.find((a) => a.accountId === accountId)

    expect(projected?.projectedChanges.filter((c) => c.type === 'recurring')).toHaveLength(0)
    expect(projected?.projectedEndingBalance).toBe(1000)
  })

  it('scopes the projection to accountId when provided', async () => {
    const db = await freshDb()
    const checkingId = nextId()
    const savingsId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: checkingId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
      { _id: savingsId, updatedAt: nowIso(), userId: 'u1', name: 'Savings', type: 'savings', currency: 'USD', currentBalance: 200, isArchived: false },
    ])
    await recurringRepo.upsertFromServer(db, [
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', title: 'Checking bill', type: 'expense', amount: 1000, currency: 'USD',
        accountId: checkingId, categoryId: 'c1', interval: 'monthly', nextDueDate: daysFromNowIso(3),
        isActive: true, isArchived: false, isCancelled: false,
      },
    ])

    const forecast = await computeLocalForecast(db, { days: 30, accountId: checkingId })
    expect(forecast.accounts).toHaveLength(1)
    expect(forecast.accounts[0].accountId).toBe(checkingId)
  })
})

describe('local forecast: savings goal auto-contributions', () => {
  it('deducts a scheduled goal auto-contribution from the linked account projection (matches server: -100)', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
    ])
    await goalsRepo.upsertFromServer(db, [
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', name: 'Emergency fund', targetAmount: 500000, currentAmount: 0,
        targetDate: null, status: 'active', accountId,
        autoContribution: { enabled: true, amount: 10000, interval: 'monthly' },
      },
    ])

    const forecast = await computeLocalForecast(db, { days: 30 })
    const projected = forecast.accounts.find((a) => a.accountId === accountId)
    const goalChanges = projected?.projectedChanges.filter((c) => c.type === 'goal') ?? []

    expect(goalChanges.length).toBeGreaterThanOrEqual(1)
    expect(goalChanges[0].amount).toBe(-100)
    expect(projected!.projectedEndingBalance).toBeLessThan(1000)
  })

  it('ignores goals with auto-contribution disabled (matches server: ending 1000)', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
    ])
    await goalsRepo.upsertFromServer(db, [
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', name: 'Vacation', targetAmount: 500000, currentAmount: 0,
        targetDate: null, status: 'active', accountId,
        autoContribution: { enabled: false, amount: 0, interval: 'monthly' },
      },
    ])

    const forecast = await computeLocalForecast(db, { days: 30 })
    const projected = forecast.accounts.find((a) => a.accountId === accountId)

    expect(projected?.projectedChanges.filter((c) => c.type === 'goal')).toHaveLength(0)
    expect(projected?.projectedEndingBalance).toBe(1000)
  })
})

describe('local forecast: discretionary spend average', () => {
  it('projects discretionary spend from trailing 90-day posted expense history (matches server: ~-300 on day 30)', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 10000, isArchived: false },
    ])
    // 900 total spend over the trailing window => avg $10/day => 30 days * $10 = $300 projected
    await transactionsRepo.upsertFromServer(db, [
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: 'c1', type: 'expense', status: 'posted',
        amount: 90000, title: 'Groceries', date: daysFromNowIso(-5), splitTransactionId: null,
      },
    ])

    const forecast = await computeLocalForecast(db, { days: 30 })
    const projected = forecast.accounts.find((a) => a.accountId === accountId)
    const discretionary = projected?.projectedChanges.find((c) => c.type === 'discretionary')

    expect(discretionary).toBeDefined()
    expect(discretionary?.amount).toBeCloseTo(-300, 0)
    expect(discretionary?.date).toBe(daysFromNowStr(30))
  })

  it('excludes recurring-linked transactions from the discretionary average', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 10000, isArchived: false },
    ])
    await transactionsRepo.upsertFromServer(db, [
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', accountId, categoryId: 'c1', type: 'expense', status: 'posted',
        amount: 90000, title: 'Bill payment', date: daysFromNowIso(-2), splitTransactionId: null, recurringPaymentId: 'r1',
      } as unknown as LocalTransaction,
    ])

    const forecast = await computeLocalForecast(db, { days: 30 })
    const projected = forecast.accounts.find((a) => a.accountId === accountId)
    const discretionary = projected?.projectedChanges.find((c) => c.type === 'discretionary')

    expect(discretionary).toBeUndefined()
  })
})

describe('local forecast: low balance warnings', () => {
  it('emits a low balance warning when the projected balance goes negative', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 100, isArchived: false },
    ])
    await recurringRepo.upsertFromServer(db, [
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', title: 'Big bill', type: 'expense', amount: 50000, currency: 'USD',
        accountId, categoryId: 'c1', interval: 'monthly', nextDueDate: daysFromNowIso(3),
        isActive: true, isArchived: false, isCancelled: false,
      },
    ])

    const forecast = await computeLocalForecast(db, { days: 30 })
    const projected = forecast.accounts.find((a) => a.accountId === accountId)

    expect(projected!.projectedEndingBalance).toBeLessThan(0)
    expect(projected!.lowBalanceWarnings.length).toBeGreaterThanOrEqual(1)
    expect(projected!.lowBalanceWarnings[0]).toHaveProperty('date')
    expect(projected!.lowBalanceWarnings[0]).toHaveProperty('projectedBalance')
  })

  it('does not emit warnings when the balance stays non-negative', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await accountsRepo.upsertFromServer(db, [
      { _id: accountId, updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, isArchived: false },
    ])
    await recurringRepo.upsertFromServer(db, [
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', title: 'Small bill', type: 'expense', amount: 2000, currency: 'USD',
        accountId, categoryId: 'c1', interval: 'monthly', nextDueDate: daysFromNowIso(3),
        isActive: true, isArchived: false, isCancelled: false,
      },
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', title: 'Paycheck', type: 'income', amount: 50000, currency: 'USD',
        accountId, categoryId: 'c1', interval: 'monthly', nextDueDate: daysFromNowIso(1),
        isActive: true, isArchived: false, isCancelled: false,
      },
    ])

    const forecast = await computeLocalForecast(db, { days: 30 })
    const projected = forecast.accounts.find((a) => a.accountId === accountId)

    expect(projected?.lowBalanceWarnings).toHaveLength(0)
  })
})

describe('local forecast: validation', () => {
  it('rejects an unsupported days value', async () => {
    const db = await freshDb()
    await expect(computeLocalForecast(db, { days: 45 })).rejects.toThrow(/days/i)
  })

  it('throws when accountId does not resolve to a known local account', async () => {
    const db = await freshDb()
    await expect(computeLocalForecast(db, { days: 30, accountId: 'missing' })).rejects.toThrow()
  })
})
