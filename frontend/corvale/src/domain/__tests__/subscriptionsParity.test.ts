import { describe, expect, it } from 'vitest'
import { MemorySqliteDriver } from '@platform/db/MemorySqliteDriver'
import { runMigrations } from '@platform/db/migrations/runMigrations'
import { MIGRATIONS } from '@platform/db/migrations/schema'
import { Repository } from '@platform/db/repositories/Repository'
import type { LocalDb } from '@platform/db/LocalDb'

import { computeLocalSubscriptions } from '../subscriptions'
import type { LocalRecurringRule } from '../types'

/**
 * Sprint 13.10 acceptance criteria for the local subscription tracker: local computation over the
 * local SQLite store must match the server's `GET /subscriptions`
 * (backend/tests/subscriptions.test.ts, backend/controllers/subscriptionController.ts) for
 * identical data.
 */

const freshDb = async (): Promise<LocalDb> => {
  const db = await MemorySqliteDriver.create()
  await runMigrations(db, MIGRATIONS)
  return db
}

const nowIso = () => new Date().toISOString()
const recurringRepo = new Repository<LocalRecurringRule>('recurringRules')

let idCounter = 0
const nextId = (): string => {
  idCounter += 1
  return `id-${idCounter.toString().padStart(6, '0')}`
}

const baseRule = (
  overrides: Partial<LocalRecurringRule> & { title: string }
): LocalRecurringRule => ({
  _id: nextId(),
  updatedAt: nowIso(),
  userId: 'u1',
  workspaceId: null,
  type: 'expense',
  amount: 1599,
  currency: 'USD',
  accountId: 'acc-1',
  categoryId: 'c1',
  interval: 'monthly',
  nextDueDate: '2026-03-01T00:00:00.000Z',
  isActive: true,
  isArchived: false,
  isCancelled: false,
  ...overrides,
})

describe('local subscriptions: eligibility', () => {
  it('returns an empty list with zero totals when there are no eligible rules', async () => {
    const db = await freshDb()
    const result = await computeLocalSubscriptions(db)
    expect(result.subscriptions).toEqual([])
    expect(result.totalMonthlyCost).toBe(0)
    expect(result.totalAnnualCost).toBe(0)
  })

  it('includes daily, weekly, biweekly, and monthly expense rules', async () => {
    const db = await freshDb()
    await recurringRepo.upsertFromServer(db, [
      baseRule({ title: 'Daily coffee', interval: 'daily' }),
      baseRule({ title: 'Weekly meal kit', interval: 'weekly' }),
      baseRule({ title: 'Biweekly cleaner', interval: 'biweekly' }),
      baseRule({ title: 'Netflix', interval: 'monthly' }),
    ])

    const result = await computeLocalSubscriptions(db)
    const titles = result.subscriptions.map((s) => s.title)
    expect(titles).toEqual(
      expect.arrayContaining(['Daily coffee', 'Weekly meal kit', 'Biweekly cleaner', 'Netflix'])
    )
    expect(result.subscriptions).toHaveLength(4)
  })

  it('excludes quarterly, yearly, and custom interval rules', async () => {
    const db = await freshDb()
    await recurringRepo.upsertFromServer(db, [
      baseRule({ title: 'Quarterly tax service', interval: 'quarterly' }),
      baseRule({ title: 'Annual domain', interval: 'yearly' }),
      baseRule({ title: 'Custom bill', interval: 'custom', customIntervalDays: 45 }),
    ])

    const result = await computeLocalSubscriptions(db)
    expect(result.subscriptions).toHaveLength(0)
  })

  it('excludes income-type recurring rules', async () => {
    const db = await freshDb()
    await recurringRepo.upsertFromServer(db, [baseRule({ title: 'Salary', type: 'income' })])

    const result = await computeLocalSubscriptions(db)
    expect(result.subscriptions).toHaveLength(0)
  })

  it('excludes inactive and archived rules', async () => {
    const db = await freshDb()
    await recurringRepo.upsertFromServer(db, [
      baseRule({ title: 'Paused sub', isActive: false }),
      baseRule({ title: 'Archived sub', isArchived: true }),
    ])

    const result = await computeLocalSubscriptions(db)
    expect(result.subscriptions).toHaveLength(0)
  })
})

describe('local subscriptions: cost calculations', () => {
  it('computes monthly and annual cost for a monthly subscription (matches server: 15.99/191.88)', async () => {
    const db = await freshDb()
    await recurringRepo.upsertFromServer(db, [baseRule({ title: 'Netflix', amount: 1599, interval: 'monthly' })])

    const result = await computeLocalSubscriptions(db)
    const sub = result.subscriptions.find((s) => s.title === 'Netflix')
    expect(sub?.monthlyCost).toBe(15.99)
    expect(sub?.annualCost).toBe(191.88)
  })

  it('computes monthly and annual cost for a weekly subscription (matches server: 520 annual, ~43.33 monthly)', async () => {
    const db = await freshDb()
    await recurringRepo.upsertFromServer(db, [baseRule({ title: 'Meal kit', amount: 1000, interval: 'weekly' })])

    const result = await computeLocalSubscriptions(db)
    const sub = result.subscriptions.find((s) => s.title === 'Meal kit')
    expect(sub?.annualCost).toBe(520)
    expect(sub?.monthlyCost).toBeCloseTo(43.33, 2)
  })

  it('computes monthly and annual cost for a daily subscription (matches server: 365 annual, ~30.42 monthly)', async () => {
    const db = await freshDb()
    await recurringRepo.upsertFromServer(db, [baseRule({ title: 'Coffee', amount: 100, interval: 'daily' })])

    const result = await computeLocalSubscriptions(db)
    const sub = result.subscriptions.find((s) => s.title === 'Coffee')
    expect(sub?.annualCost).toBe(365)
    expect(sub?.monthlyCost).toBeCloseTo(30.42, 2)
  })

  it('sums totalMonthlyCost and totalAnnualCost across all active subscriptions (matches server: 25.98/311.76)', async () => {
    const db = await freshDb()
    await recurringRepo.upsertFromServer(db, [
      baseRule({ title: 'Netflix', amount: 1599, interval: 'monthly' }),
      baseRule({ title: 'Spotify', amount: 999, interval: 'monthly' }),
    ])

    const result = await computeLocalSubscriptions(db)
    expect(result.totalMonthlyCost).toBeCloseTo(25.98, 2)
    expect(result.totalAnnualCost).toBeCloseTo(311.76, 2)
  })
})

describe('local subscriptions: cancelled flag', () => {
  it('excludes cancelled subscriptions from totals but keeps them listed (matches server: 2 listed, 10 total monthly)', async () => {
    const db = await freshDb()
    await recurringRepo.upsertFromServer(db, [
      baseRule({ title: 'Active sub', amount: 1000, interval: 'monthly' }),
      baseRule({ title: 'Cancelled sub', amount: 2000, interval: 'monthly', isCancelled: true }),
    ])

    const result = await computeLocalSubscriptions(db)
    expect(result.subscriptions).toHaveLength(2)
    expect(result.totalMonthlyCost).toBe(10)

    const cancelled = result.subscriptions.find((s) => s.title === 'Cancelled sub')
    expect(cancelled?.isCancelled).toBe(true)
  })
})

describe('local subscriptions: workspace scoping', () => {
  it('only includes workspace-scoped subscriptions when a workspaceId is given', async () => {
    const db = await freshDb()
    const workspaceId = 'ws-1'
    await recurringRepo.upsertFromServer(db, [
      baseRule({ title: 'Shared subscription', workspaceId }),
      baseRule({ title: 'Personal subscription', workspaceId: null }),
    ])

    const result = await computeLocalSubscriptions(db, { workspaceId })
    const titles = result.subscriptions.map((s) => s.title)
    expect(titles).toContain('Shared subscription')
    expect(titles).not.toContain('Personal subscription')
  })
})
