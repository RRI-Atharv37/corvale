import { describe, expect, it } from 'vitest'
import { MemorySqliteDriver } from '@platform/db/MemorySqliteDriver'
import { runMigrations } from '@platform/db/migrations/runMigrations'
import { MIGRATIONS } from '@platform/db/migrations/schema'
import { Repository } from '@platform/db/repositories/Repository'
import type { LocalDb } from '@platform/db/LocalDb'

import { computeLocalCalendar } from '../calendar'
import type { LocalBudget, LocalRecurringRule, LocalSavingsGoal } from '../types'

/**
 * Sprint 13.10 acceptance criteria for the local financial calendar: local computation over the
 * local SQLite store must match the server's `GET /calendar` (backend/tests/calendar.test.ts,
 * backend/controllers/calendarController.ts) for identical data.
 */

const freshDb = async (): Promise<LocalDb> => {
  const db = await MemorySqliteDriver.create()
  await runMigrations(db, MIGRATIONS)
  return db
}

const nowIso = () => new Date().toISOString()

const recurringRepo = new Repository<LocalRecurringRule>('recurringRules')
const budgetsRepo = new Repository<LocalBudget>('budgets')
const goalsRepo = new Repository<LocalSavingsGoal & { accountId?: string | null }>('savingsGoals')

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

describe('local calendar: validation', () => {
  it('returns an empty array when nothing falls in range', async () => {
    const db = await freshDb()
    const events = await computeLocalCalendar(db, {
      start: daysFromNowStr(0),
      end: daysFromNowStr(30),
      timezone: 'UTC',
    })
    expect(events).toEqual([])
  })

  it('rejects an invalid date range where start is after end', async () => {
    const db = await freshDb()
    await expect(
      computeLocalCalendar(db, { start: daysFromNowStr(30), end: daysFromNowStr(0), timezone: 'UTC' })
    ).rejects.toThrow()
  })

  it('rejects malformed date strings', async () => {
    const db = await freshDb()
    await expect(
      computeLocalCalendar(db, { start: 'not-a-date', end: '2026-02-01', timezone: 'UTC' })
    ).rejects.toThrow()
  })
})

describe('local calendar: recurring due dates', () => {
  it('includes a recurring occurrence within range with refId and amount (matches server)', async () => {
    const db = await freshDb()
    const accountId = nextId()
    const ruleId = nextId()
    await recurringRepo.upsertFromServer(db, [
      {
        _id: ruleId, updatedAt: nowIso(), userId: 'u1', title: 'Netflix', type: 'expense', amount: 1599, currency: 'USD',
        accountId, categoryId: 'c1', interval: 'monthly', nextDueDate: daysFromNowIso(10),
        isActive: true, isArchived: false, isCancelled: false,
      },
    ])

    const events = await computeLocalCalendar(db, { start: daysFromNowStr(0), end: daysFromNowStr(30), timezone: 'UTC' })
    const recurringEvents = events.filter((e) => e.type === 'recurring')

    expect(recurringEvents).toHaveLength(1)
    expect(recurringEvents[0]).toMatchObject({
      type: 'recurring',
      title: 'Netflix',
      amount: 15.99,
      date: daysFromNowStr(10),
      refId: ruleId,
    })
  })

  it('includes multiple occurrences for a weekly rule spanning the range (matches server: >=4)', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await recurringRepo.upsertFromServer(db, [
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', title: 'Groceries budget', type: 'expense', amount: 1000, currency: 'USD',
        accountId, categoryId: 'c1', interval: 'weekly', nextDueDate: daysFromNowIso(1),
        isActive: true, isArchived: false, isCancelled: false,
      },
    ])

    const events = await computeLocalCalendar(db, { start: daysFromNowStr(0), end: daysFromNowStr(30), timezone: 'UTC' })
    const recurringEvents = events.filter((e) => e.type === 'recurring')
    expect(recurringEvents.length).toBeGreaterThanOrEqual(4)
  })

  it('excludes inactive and archived recurring rules', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await recurringRepo.upsertFromServer(db, [
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', title: 'Paused', type: 'expense', amount: 1000, currency: 'USD',
        accountId, categoryId: 'c1', interval: 'monthly', nextDueDate: daysFromNowIso(5),
        isActive: false, isArchived: false, isCancelled: false,
      },
    ])

    const events = await computeLocalCalendar(db, { start: daysFromNowStr(0), end: daysFromNowStr(30), timezone: 'UTC' })
    expect(events.filter((e) => e.type === 'recurring')).toHaveLength(0)
  })
})

describe('local calendar: budget period boundaries', () => {
  it('includes a budget period end within range (matches server: date 2026-01-31)', async () => {
    const db = await freshDb()
    const budgetId = nextId()
    await budgetsRepo.upsertFromServer(db, [
      {
        _id: budgetId, updatedAt: nowIso(), userId: 'u1', categoryId: null,
        periodStart: '2026-01-01T00:00:00.000Z', periodEnd: '2026-01-31T23:59:59.999Z',
        amount: 50000, accountIds: [], isArchived: false,
      },
    ])

    const events = await computeLocalCalendar(db, { start: '2026-01-01', end: '2026-01-31', timezone: 'UTC' })
    const budgetEvents = events.filter((e) => e.type === 'budget_end')

    expect(budgetEvents).toHaveLength(1)
    expect(budgetEvents[0].refId).toBe(budgetId)
    expect(budgetEvents[0].date).toBe('2026-01-31')
  })

  it('excludes archived budgets', async () => {
    const db = await freshDb()
    await budgetsRepo.upsertFromServer(db, [
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', categoryId: null,
        periodStart: '2026-01-01T00:00:00.000Z', periodEnd: '2026-01-31T23:59:59.999Z',
        amount: 50000, accountIds: [], isArchived: true,
      },
    ])

    const events = await computeLocalCalendar(db, { start: '2026-01-01', end: '2026-01-31', timezone: 'UTC' })
    expect(events.filter((e) => e.type === 'budget_end')).toHaveLength(0)
  })

  it('excludes a budget period end outside the requested range', async () => {
    const db = await freshDb()
    await budgetsRepo.upsertFromServer(db, [
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', categoryId: null,
        periodStart: '2026-03-01T00:00:00.000Z', periodEnd: '2026-03-31T23:59:59.999Z',
        amount: 50000, accountIds: [], isArchived: false,
      },
    ])

    const events = await computeLocalCalendar(db, { start: '2026-01-01', end: '2026-01-31', timezone: 'UTC' })
    expect(events.filter((e) => e.type === 'budget_end')).toHaveLength(0)
  })
})

describe('local calendar: goal deadlines', () => {
  it('includes a savings goal targetDate within range (matches server)', async () => {
    const db = await freshDb()
    const goalId = nextId()
    await goalsRepo.upsertFromServer(db, [
      {
        _id: goalId, updatedAt: nowIso(), userId: 'u1', name: 'Vacation', targetAmount: 200000, currentAmount: 0,
        targetDate: '2026-01-20T00:00:00.000Z', status: 'active',
        autoContribution: { enabled: false, amount: 0, interval: 'monthly' },
      },
    ])

    const events = await computeLocalCalendar(db, { start: '2026-01-01', end: '2026-01-31', timezone: 'UTC' })
    const goalEvents = events.filter((e) => e.type === 'goal_deadline')

    expect(goalEvents).toHaveLength(1)
    expect(goalEvents[0].refId).toBe(goalId)
    expect(goalEvents[0].title).toBe('Vacation')
    expect(goalEvents[0].date).toBe('2026-01-20')
  })

  it('excludes goals without a targetDate', async () => {
    const db = await freshDb()
    await goalsRepo.upsertFromServer(db, [
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', name: 'No deadline', targetAmount: 200000, currentAmount: 0,
        targetDate: null, status: 'active',
        autoContribution: { enabled: false, amount: 0, interval: 'monthly' },
      },
    ])

    const events = await computeLocalCalendar(db, { start: daysFromNowStr(0), end: daysFromNowStr(365), timezone: 'UTC' })
    expect(events.filter((e) => e.type === 'goal_deadline')).toHaveLength(0)
  })

  it('excludes completed and archived goals', async () => {
    const db = await freshDb()
    await goalsRepo.upsertFromServer(db, [
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', name: 'Done goal', targetAmount: 10000, currentAmount: 10000,
        targetDate: '2026-01-20T00:00:00.000Z', status: 'completed',
        autoContribution: { enabled: false, amount: 0, interval: 'monthly' },
      },
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', name: 'Archived goal', targetAmount: 10000, currentAmount: 0,
        targetDate: '2026-01-21T00:00:00.000Z', status: 'archived',
        autoContribution: { enabled: false, amount: 0, interval: 'monthly' },
      },
    ])

    const events = await computeLocalCalendar(db, { start: '2026-01-01', end: '2026-01-31', timezone: 'UTC' })
    expect(events.filter((e) => e.type === 'goal_deadline')).toHaveLength(0)
  })
})

describe('local calendar: mixed events and ordering', () => {
  it('returns mixed event types sorted ascending by date', async () => {
    const db = await freshDb()
    const accountId = nextId()
    await recurringRepo.upsertFromServer(db, [
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', title: 'Mid-month bill', type: 'expense', amount: 1000, currency: 'USD',
        accountId, categoryId: 'c1', interval: 'monthly', nextDueDate: '2026-01-15T00:00:00.000Z',
        isActive: true, isArchived: false, isCancelled: false,
      },
    ])
    await budgetsRepo.upsertFromServer(db, [
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', categoryId: null,
        periodStart: '2026-01-01T00:00:00.000Z', periodEnd: '2026-01-31T23:59:59.999Z',
        amount: 50000, accountIds: [], isArchived: false,
      },
    ])
    await goalsRepo.upsertFromServer(db, [
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', name: 'Early goal', targetAmount: 10000, currentAmount: 0,
        targetDate: '2026-01-05T00:00:00.000Z', status: 'active',
        autoContribution: { enabled: false, amount: 0, interval: 'monthly' },
      },
    ])

    const events = await computeLocalCalendar(db, { start: '2026-01-01', end: '2026-01-31', timezone: 'UTC' })
    expect(events.length).toBeGreaterThanOrEqual(3)

    const dates = events.map((e) => e.date)
    const sorted = [...dates].sort()
    expect(dates).toEqual(sorted)
  })
})

describe('local calendar: workspace scoping', () => {
  it('only includes workspace-scoped events when a workspaceId is given', async () => {
    const db = await freshDb()
    const accountId = nextId()
    const workspaceId = 'ws-1'
    await recurringRepo.upsertFromServer(db, [
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', workspaceId, title: 'Shared bill', type: 'expense', amount: 5000, currency: 'USD',
        accountId, categoryId: 'c1', interval: 'monthly', nextDueDate: daysFromNowIso(5),
        isActive: true, isArchived: false, isCancelled: false,
      },
      {
        _id: nextId(), updatedAt: nowIso(), userId: 'u1', workspaceId: null, title: 'Personal bill', type: 'expense', amount: 5000, currency: 'USD',
        accountId, categoryId: 'c1', interval: 'monthly', nextDueDate: daysFromNowIso(5),
        isActive: true, isArchived: false, isCancelled: false,
      },
    ])

    const events = await computeLocalCalendar(db, {
      start: daysFromNowStr(0),
      end: daysFromNowStr(30),
      timezone: 'UTC',
      workspaceId,
    })
    const titles = events.map((e) => e.title)
    expect(titles).toContain('Shared bill')
    expect(titles).not.toContain('Personal bill')
  })
})
