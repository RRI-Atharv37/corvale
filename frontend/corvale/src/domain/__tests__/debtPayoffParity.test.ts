import { describe, expect, it } from 'vitest'
import { MemorySqliteDriver } from '@platform/db/MemorySqliteDriver'
import { runMigrations } from '@platform/db/migrations/runMigrations'
import { MIGRATIONS } from '@platform/db/migrations/schema'
import { Repository } from '@platform/db/repositories/Repository'
import type { LocalDb } from '@platform/db/LocalDb'

import { computeLocalDebtPayoffPlan } from '../debtPayoff'
import { orderDebtsByAvalanche, orderDebtsBySnowball, generatePayoffSchedule } from '@shared/debtPayoff'
import type { LocalAccount } from '../types'

/**
 * Sprint 13.10 acceptance criteria for the local debt payoff planner: local computation over the
 * local SQLite store must match the server's `POST /debts/plan`
 * (backend/tests/debtPayoff.test.ts, backend/controllers/debtPayoffController.ts) for identical
 * data.
 */

const freshDb = async (): Promise<LocalDb> => {
  const db = await MemorySqliteDriver.create()
  await runMigrations(db, MIGRATIONS)
  return db
}

const nowIso = () => new Date().toISOString()
const accountsRepo = new Repository<LocalAccount & { interestRate?: number; minimumPayment?: number }>('accounts')

let idCounter = 0
const nextId = (): string => {
  idCounter += 1
  return `id-${idCounter.toString().padStart(6, '0')}`
}

const creditAccount = (
  overrides: Partial<LocalAccount & { interestRate?: number; minimumPayment?: number }> & { name: string }
) => ({
  _id: nextId(),
  updatedAt: nowIso(),
  userId: 'u1',
  workspaceId: null as string | null,
  currency: 'USD',
  type: 'credit' as const,
  currentBalance: -1000,
  isArchived: false,
  interestRate: 24,
  minimumPayment: 50,
  ...overrides,
})

describe('local debt payoff: validation and eligibility', () => {
  it('rejects a credit account missing interestRate or minimumPayment when included by id', async () => {
    const db = await freshDb()
    const account = creditAccount({ name: 'Unconfigured card', interestRate: undefined, minimumPayment: undefined })
    await accountsRepo.upsertFromServer(db, [account])

    await expect(
      computeLocalDebtPayoffPlan(db, { strategy: 'snowball', extraPayment: 0, accountIds: [account._id] })
    ).rejects.toThrow(/interestRate|minimum payment/)
  })

  it('returns an empty plan when the user has no credit debt', async () => {
    const db = await freshDb()
    await accountsRepo.upsertFromServer(db, [
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', workspaceId: null, name: 'Checking', currency: 'USD', type: 'checking', currentBalance: 500, isArchived: false },
    ])

    const plan = await computeLocalDebtPayoffPlan(db, { strategy: 'snowball', extraPayment: 100 })
    expect(plan.order).toEqual([])
    expect(plan.totalMonths).toBe(0)
  })

  it('excludes non-credit and paid-off (non-negative balance) accounts from the default listing', async () => {
    const db = await freshDb()
    const paidOff = creditAccount({ name: 'Paid off card', currentBalance: 0 })
    const active = creditAccount({ name: 'Active card', currentBalance: -300 })
    await accountsRepo.upsertFromServer(db, [
      { _id: nextId(), updatedAt: nowIso(), userId: 'u1', workspaceId: null, name: 'Savings', currency: 'USD', type: 'savings', currentBalance: 500, isArchived: false },
      paidOff,
      active,
    ])

    const plan = await computeLocalDebtPayoffPlan(db, { strategy: 'snowball', extraPayment: 50 })
    expect(plan.order).toEqual([active._id])
    expect(plan.order).not.toContain(paidOff._id)
  })
})

describe('local debt payoff: ordering strategies (matches server)', () => {
  it('orders debts by ascending balance for snowball regardless of APR', async () => {
    const db = await freshDb()
    const big = creditAccount({ name: 'Big low-APR debt', currentBalance: -2000, interestRate: 5, minimumPayment: 40 })
    const small = creditAccount({ name: 'Small high-APR debt', currentBalance: -500, interestRate: 25, minimumPayment: 20 })
    await accountsRepo.upsertFromServer(db, [big, small])

    const plan = await computeLocalDebtPayoffPlan(db, { strategy: 'snowball', extraPayment: 100 })
    expect(plan.order).toEqual([small._id, big._id])
  })

  it('orders debts by descending APR for avalanche regardless of balance', async () => {
    const db = await freshDb()
    const highApr = creditAccount({ name: 'High APR debt', currentBalance: -2000, interestRate: 20, minimumPayment: 40 })
    const lowApr = creditAccount({ name: 'Low APR debt', currentBalance: -500, interestRate: 5, minimumPayment: 20 })
    await accountsRepo.upsertFromServer(db, [highApr, lowApr])

    const plan = await computeLocalDebtPayoffPlan(db, { strategy: 'avalanche', extraPayment: 100 })
    expect(plan.order).toEqual([highApr._id, lowApr._id])
  })
})

describe('local debt payoff: schedule calculations (matches server)', () => {
  it('computes an exact payoff timeline for a single 0% APR debt (3 months, zero interest)', async () => {
    const db = await freshDb()
    const account = creditAccount({ name: 'Zero APR card', currentBalance: -300, interestRate: 0, minimumPayment: 50 })
    await accountsRepo.upsertFromServer(db, [account])

    const plan = await computeLocalDebtPayoffPlan(db, { strategy: 'snowball', extraPayment: 50 })
    expect(plan.totalMonths).toBe(3)
    expect(plan.totalInterestPaid).toBe(0)

    const lastMonth = plan.months[plan.months.length - 1]
    expect(lastMonth.payments[0].remainingBalance).toBe(0)
  })

  it('pays off a single debt in one month when the payment covers balance plus interest', async () => {
    const db = await freshDb()
    // 12% APR => 1%/month interest on $1000 = $10; minimumPayment covers principal + interest exactly
    const account = creditAccount({ name: 'One shot card', currentBalance: -1000, interestRate: 12, minimumPayment: 1010 })
    await accountsRepo.upsertFromServer(db, [account])

    const plan = await computeLocalDebtPayoffPlan(db, { strategy: 'snowball', extraPayment: 0 })
    expect(plan.totalMonths).toBe(1)
    expect(plan.totalInterestPaid).toBeCloseTo(10, 2)
    expect(plan.months[0].payments[0].remainingBalance).toBe(0)
  })

  it('rolls a paid-off debt minimum payment into the next target under snowball (11 months total)', async () => {
    const db = await freshDb()
    const small = creditAccount({ name: 'Small debt', currentBalance: -100, interestRate: 0, minimumPayment: 25 })
    const large = creditAccount({ name: 'Large debt', currentBalance: -1000, interestRate: 0, minimumPayment: 50 })
    await accountsRepo.upsertFromServer(db, [small, large])

    const plan = await computeLocalDebtPayoffPlan(db, { strategy: 'snowball', extraPayment: 25 })
    expect(plan.order).toEqual([small._id, large._id])
    expect(plan.totalMonths).toBe(11)
    expect(plan.totalInterestPaid).toBe(0)

    const month2 = plan.months[1]
    const smallPaymentMonth2 = month2.payments.find((p) => p.accountId === small._id)
    expect(smallPaymentMonth2?.remainingBalance).toBe(0)
  })

  it('reports positive totalInterestPaid for a debt with positive APR', async () => {
    const db = await freshDb()
    const account = creditAccount({ name: 'Interest card', currentBalance: -1000, interestRate: 24, minimumPayment: 50 })
    await accountsRepo.upsertFromServer(db, [account])

    const plan = await computeLocalDebtPayoffPlan(db, { strategy: 'avalanche', extraPayment: 0 })
    expect(plan.totalInterestPaid).toBeGreaterThan(0)
    expect(plan.months[0].payments[0].interestPaid).toBeCloseTo(20, 2)
  })

  it('rejects a plan where the minimum payment cannot cover monthly interest (negative amortization)', async () => {
    const db = await freshDb()
    // 50% APR => ~4.17%/month interest on $1000 = ~$41.67, minimumPayment of $10 never reduces the balance
    const account = creditAccount({ name: 'Runaway card', currentBalance: -1000, interestRate: 50, minimumPayment: 10 })
    await accountsRepo.upsertFromServer(db, [account])

    await expect(computeLocalDebtPayoffPlan(db, { strategy: 'snowball', extraPayment: 0 })).rejects.toThrow(
      /minimum payment|interest|cannot be paid off/i
    )
  })
})

describe('local debt payoff: scoping', () => {
  it('limits the plan to accountIds when provided', async () => {
    const db = await freshDb()
    const included = creditAccount({ name: 'Included debt', currentBalance: -300 })
    const excluded = creditAccount({ name: 'Excluded debt', currentBalance: -400 })
    await accountsRepo.upsertFromServer(db, [included, excluded])

    const plan = await computeLocalDebtPayoffPlan(db, {
      strategy: 'snowball',
      extraPayment: 0,
      accountIds: [included._id],
    })
    expect(plan.order).toEqual([included._id])
    expect(plan.order).not.toContain(excluded._id)
  })

  it('only includes workspace credit accounts when a workspaceId is given', async () => {
    const db = await freshDb()
    const workspaceId = 'ws-1'
    const wsAccount = creditAccount({ name: 'Shared card', currentBalance: -300, workspaceId })
    const personalAccount = creditAccount({ name: 'Personal card', currentBalance: -400, workspaceId: null })
    await accountsRepo.upsertFromServer(db, [wsAccount, personalAccount])

    const plan = await computeLocalDebtPayoffPlan(db, { strategy: 'snowball', extraPayment: 0, workspaceId })
    expect(plan.order).toContain(wsAccount._id)
    expect(plan.order).not.toContain(personalAccount._id)
  })
})

describe('debtPayoff shared functions (sanity, mirrors backend debtPayoffUtils suite)', () => {
  it('orders debts by ascending balance for snowball', () => {
    const ordered = orderDebtsBySnowball([
      { accountId: 'a', balanceMinor: 200000, interestRate: 5, minimumPaymentMinor: 4000 },
      { accountId: 'b', balanceMinor: 50000, interestRate: 25, minimumPaymentMinor: 2000 },
    ])
    expect(ordered.map((d) => d.accountId)).toEqual(['b', 'a'])
  })

  it('orders debts by descending interest rate for avalanche', () => {
    const ordered = orderDebtsByAvalanche([
      { accountId: 'a', balanceMinor: 200000, interestRate: 5, minimumPaymentMinor: 4000 },
      { accountId: 'b', balanceMinor: 50000, interestRate: 25, minimumPaymentMinor: 2000 },
    ])
    expect(ordered.map((d) => d.accountId)).toEqual(['b', 'a'])
  })

  it('generates a payoff schedule for a single zero-interest debt', () => {
    const plan = generatePayoffSchedule(
      [{ accountId: 'a', balanceMinor: 30000, interestRate: 0, minimumPaymentMinor: 5000 }],
      5000,
      'snowball'
    )
    expect(plan.totalMonths).toBe(3)
    expect(plan.totalInterestMinor).toBe(0)
  })
})
