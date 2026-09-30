import { describe, expect, it } from 'vitest'
import { MemorySqliteDriver } from '@platform/db/MemorySqliteDriver'
import { runMigrations } from '@platform/db/migrations/runMigrations'
import { MIGRATIONS } from '@platform/db/migrations/schema'
import { Repository } from '@platform/db/repositories/Repository'
import { createSqliteOutboxStore } from '@platform/sync/sqliteOutboxStore'
import type { LocalDb } from '@platform/db/LocalDb'
import type { LocalAccount, LocalCategory, LocalTransaction } from '../types'
import { previewLocalRestore, restoreLocalBackup, type CorvaleBackupPayload } from '../backup'

/**
 * S50 / SEC-85, desktop half: a file restored on the desktop is checked against the same rules as
 * the server restore (`shared/src/backupValidation.ts`, server tests in
 * `backend/src/modules/backup/__tests__/backupRestoreValidation.test.ts`). The local database is
 * the ledger the user sees and, for a workspace, what they push to everyone else, so a crafted file
 * must be refused before a single row is written, not only when the server later rejects the ops.
 */

const freshDb = async (): Promise<LocalDb> => {
  const db = await MemorySqliteDriver.create()
  await runMigrations(db, MIGRATIONS)
  return db
}

const accountsRepo = new Repository<LocalAccount>('accounts')
const categoriesRepo = new Repository<LocalCategory>('categories')
const transactionsRepo = new Repository<LocalTransaction & { hasSplitChildren?: boolean }>('transactions')
const budgetsRepo = new Repository<{ _id: string; updatedAt: string }>('budgets')
const goalsRepo = new Repository<{ _id: string; updatedAt: string; name: string; currentAmount: number; status: string }>(
  'savingsGoals'
)
const rulesRepo = new Repository<{ _id: string; updatedAt: string }>('categorizationRules')

const MASTER_ID = 'master-food'
const NOW = '2026-01-01T00:00:00.000Z'
const nowIso = () => new Date().toISOString()

const seedTarget = async (): Promise<LocalDb> => {
  const db = await freshDb()
  await categoriesRepo.upsertFromServer(db, [
    { _id: MASTER_ID, updatedAt: nowIso(), userId: null, masterCategoryId: null, name: 'Food', isArchived: false },
  ])
  return db
}

const payloadOf = (overrides: Partial<CorvaleBackupPayload>): CorvaleBackupPayload => ({
  version: 1,
  exportedAt: '2026-02-01T00:00:00.000Z',
  scope: { workspaceId: null },
  counts: {
    accounts: 0,
    categories: 0,
    tags: 0,
    budgets: 0,
    savingsGoals: 0,
    savingsGoalContributions: 0,
    recurringRules: 0,
    categorizationRules: 0,
    transactionTemplates: 0,
    transactions: 0,
    receipts: 0,
  },
  accounts: [],
  categories: [],
  tags: [],
  budgets: [],
  savingsGoals: [],
  savingsGoalContributions: [],
  recurringRules: [],
  categorizationRules: [],
  transactionTemplates: [],
  transactions: [],
  receipts: [],
  ...overrides,
})

const accountRecord = (id: string, type = 'checking', overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Account ${id}`,
  type,
  currency: 'USD',
  openingBalance: 1000,
  isArchived: false,
  ...overrides,
})

const txRecord = (id: string, accountId: string, overrides: Record<string, unknown> = {}) => ({
  id,
  accountId,
  categoryId: MASTER_ID,
  type: 'expense',
  status: 'posted',
  amount: 1000,
  currency: 'USD',
  title: `Txn ${id}`,
  date: '2026-01-15T12:00:00.000Z',
  createdAt: '2026-01-15T12:00:00.000Z',
  ...overrides,
})

const base = () => ({ accounts: [accountRecord('A'), accountRecord('B')] })
const leg = (id: string, accountId: string, pair: string, overrides: Record<string, unknown> = {}) =>
  txRecord(id, accountId, { type: 'transfer', amount: 2500, transferPairId: pair, ...overrides })
const split = (id: string, amount: number, parent: string, overrides: Record<string, unknown> = {}) =>
  txRecord(id, 'A', { amount, splitTransactionId: parent, ...overrides })

const restore = (db: LocalDb, payload: CorvaleBackupPayload) =>
  restoreLocalBackup(db, payload, { userId: 'u2', targetWorkspaceId: null })

const nothingWritten = async (db: LocalDb) => {
  expect(await accountsRepo.list(db)).toHaveLength(0)
  expect(await transactionsRepo.list(db)).toHaveLength(0)
  expect(await budgetsRepo.list(db)).toHaveLength(0)
  expect(await goalsRepo.list(db)).toHaveLength(0)
  expect(await rulesRepo.list(db)).toHaveLength(0)
  expect(await createSqliteOutboxStore(db).list()).toHaveLength(0)
}

const monthlyBudget = (overrides: Record<string, unknown> = {}) => ({
  id: 'b',
  name: 'B',
  periodType: 'monthly',
  periodStart: NOW,
  periodEnd: '2026-01-31T00:00:00.000Z',
  amount: 100,
  currency: 'USD',
  ...overrides,
})

const recurring = (overrides: Record<string, unknown> = {}) => ({
  id: 'r',
  title: 'R',
  type: 'expense',
  amount: 100,
  currency: 'USD',
  accountId: 'A',
  categoryId: MASTER_ID,
  interval: 'monthly',
  nextDueDate: NOW,
  ...overrides,
})

const rule = (overrides: Record<string, unknown> = {}) => ({
  id: 'k',
  name: 'K',
  matchType: 'description_contains',
  matchValue: 'coffee',
  categoryId: MASTER_ID,
  ...overrides,
})

const template = (overrides: Record<string, unknown> = {}) => ({
  id: 'm',
  name: 'M',
  type: 'expense',
  amount: 500,
  accountId: 'A',
  categoryId: MASTER_ID,
  ...overrides,
})

const cases: Array<[string, Partial<CorvaleBackupPayload>]> = [
  ['a fractional transaction amount', { ...base(), transactions: [txRecord('t', 'A', { amount: 10.5 })] }],
  ['a negative transaction amount', { ...base(), transactions: [txRecord('t', 'A', { amount: -5 })] }],
  ['an amount sent as a string', { ...base(), transactions: [txRecord('t', 'A', { amount: '100' })] }],
  [
    'an amount past the safe integer range',
    { ...base(), transactions: [txRecord('t', 'A', { amount: Number.MAX_SAFE_INTEGER + 2 })] },
  ],
  ['a currency that does not match the account', { ...base(), transactions: [txRecord('t', 'A', { currency: 'EUR' })] }],
  ['an unknown transaction type', { ...base(), transactions: [txRecord('t', 'A', { type: 'refund' })] }],
  ['an unknown cleared status', { ...base(), transactions: [txRecord('t', 'A', { clearedStatus: 'settled' })] }],
  ['an unreadable date', { ...base(), transactions: [txRecord('t', 'A', { date: 'not-a-date' })] }],
  ['an oversized external id', { ...base(), transactions: [txRecord('t', 'A', { externalId: 'x'.repeat(300) })] }],
  ['tags that are not strings', { ...base(), transactions: [txRecord('t', 'A', { tags: [{ a: 1 }] })] }],
  ['two transactions with one id', { ...base(), transactions: [txRecord('t', 'A'), txRecord('t', 'A')] }],
  ['an unpaired transfer leg', { ...base(), transactions: [txRecord('t', 'A', { type: 'transfer' })] }],
  [
    'a transfer whose pair is an ordinary transaction',
    { ...base(), transactions: [leg('out', 'A', 'plain'), txRecord('plain', 'B', { amount: 2500 })] },
  ],
  [
    'a transfer whose pair id names a budget',
    {
      ...base(),
      budgets: [monthlyBudget({ id: 'bud' })],
      transactions: [leg('out', 'A', 'bud'), leg('in', 'B', 'out')],
    },
  ],
  [
    'legs that do not name each other',
    { ...base(), transactions: [leg('out', 'A', 'in'), leg('in', 'B', 'third'), leg('third', 'A', 'in')] },
  ],
  ['legs on one account', { ...base(), transactions: [leg('out', 'A', 'in'), leg('in', 'A', 'out')] }],
  ['legs with different amounts', { ...base(), transactions: [leg('out', 'A', 'in'), leg('in', 'B', 'out', { amount: 9999 })] }],
  [
    'two legs claiming the same direction',
    {
      ...base(),
      transactions: [leg('out', 'A', 'in', { transferRole: 'out' }), leg('in', 'B', 'out', { transferRole: 'out' })],
    },
  ],
  [
    'a non-transfer carrying a pair id',
    { ...base(), transactions: [txRecord('x', 'A', { transferPairId: 'y' }), txRecord('y', 'B')] },
  ],
  [
    'split lines that do not add up',
    { ...base(), transactions: [txRecord('p', 'A', { amount: 1000 }), split('c1', 600, 'p'), split('c2', 300, 'p')] },
  ],
  ['a split parent with one line', { ...base(), transactions: [txRecord('p', 'A', { amount: 1000 }), split('c1', 1000, 'p')] }],
  [
    'a split line under a split line',
    {
      ...base(),
      transactions: [txRecord('p', 'A', { amount: 1000 }), split('c1', 500, 'p'), split('c2', 500, 'p'), split('g', 500, 'c1')],
    },
  ],
  [
    'a split parent that is income',
    {
      ...base(),
      transactions: [txRecord('p', 'A', { type: 'income', amount: 1000 }), split('c1', 500, 'p'), split('c2', 500, 'p')],
    },
  ],
  ['a fractional minor-unit opening balance', { accounts: [accountRecord('A', 'checking', { balanceUnit: 'minor', openingBalance: 10.5 })] }],
  ['credit terms on a checking account', { accounts: [accountRecord('A', 'checking', { interestRate: 12 })] }],
  ['a negative interest rate', { accounts: [accountRecord('A', 'credit', { interestRate: -1 })] }],
  ['an unsupported account currency', { accounts: [accountRecord('A', 'checking', { currency: 'XXX' })] }],
  ['a fractional budget amount', { budgets: [monthlyBudget({ amount: 100.5 })] }],
  [
    'a budget that ends before it starts',
    { budgets: [monthlyBudget({ periodType: 'custom', periodStart: '2026-02-01T00:00:00.000Z', periodEnd: NOW })] },
  ],
  ['a fractional goal target', { savingsGoals: [{ id: 'g', name: 'G', targetAmount: 10.5, currency: 'USD' }] }],
  [
    'a fractional contribution',
    {
      savingsGoals: [{ id: 'g', name: 'G', targetAmount: 1000, currency: 'USD' }],
      savingsGoalContributions: [{ id: 'c', goalId: 'g', amount: 1.5, type: 'manual', contributedAt: NOW }],
    },
  ],
  [
    'an auto-contribution day outside 1-28',
    {
      savingsGoals: [
        {
          id: 'g',
          name: 'G',
          targetAmount: 1000,
          currency: 'USD',
          autoContribution: { enabled: true, amount: 100, interval: 'monthly', dayOfMonth: 40 },
        },
      ],
    },
  ],
  ['a custom recurring rule with no interval days', { ...base(), recurringRules: [recurring({ interval: 'custom' })] }],
  ['a recurring transfer', { ...base(), recurringRules: [recurring({ type: 'transfer' })] }],
  [
    'a recurring rule in another currency than its account',
    { ...base(), recurringRules: [recurring({ currency: 'EUR' })] },
  ],
  ['a rule match value over 200 characters', { categorizationRules: [rule({ matchValue: 'x'.repeat(201) })] }],
  ['an amount-range rule with no bounds', { categorizationRules: [rule({ matchType: 'amount_range', matchValue: undefined })] }],
  [
    'an amount-range rule with min above max',
    { categorizationRules: [rule({ matchType: 'amount_range', amountMin: 500, amountMax: 100 })] },
  ],
  ['an account rule with no account', { categorizationRules: [rule({ matchType: 'account_id' })] }],
  ['a rule with an unknown match type', { categorizationRules: [rule({ matchType: 'regex' })] }],
  ['a fractional template amount', { ...base(), transactionTemplates: [template({ amount: 5.5 })] }],
  ['a transfer template', { ...base(), transactionTemplates: [template({ type: 'transfer' })] }],
  ['a category with no name', { categories: [{ id: 'c', name: '  ', masterCategoryId: MASTER_ID }] }],
  [
    'a custom category whose parent is another custom category',
    {
      categories: [
        { id: 'c1', name: 'One', masterCategoryId: MASTER_ID },
        { id: 'c2', name: 'Two', masterCategoryId: 'c1' },
      ],
    },
  ],
  ['a tag name over 50 characters', { tags: [{ id: 't', name: 'x'.repeat(51) }] }],
  [
    'a transaction whose account id names a budget',
    { budgets: [monthlyBudget({ id: 'bud' })], transactions: [txRecord('t', 'bud')] },
  ],
  ['a rule whose category id names an account', { ...base(), categorizationRules: [rule({ categoryId: 'A' })] }],
  [
    'a budget whose account list names a rule',
    { categorizationRules: [rule({ id: 'k' })], budgets: [monthlyBudget({ accountIds: ['k'] })] },
  ],
  [
    'a contribution whose goal id names a recurring rule',
    {
      ...base(),
      recurringRules: [recurring({ id: 'r' })],
      savingsGoalContributions: [{ id: 'c', goalId: 'r', amount: 100, type: 'manual', contributedAt: NOW }],
    },
  ],
]

describe('restoreLocalBackup - a crafted file is refused like the server refuses it (SEC-85)', () => {
  it.each(cases)('refuses %s, reports it in the preview and writes nothing', async (_label, overrides) => {
    const db = await seedTarget()
    const payload = payloadOf(overrides)

    const preview = previewLocalRestore(db, payload, null)
    expect(preview.valid).toBe(false)
    expect(preview.errors.length).toBeGreaterThan(0)

    await expect(restore(db, payload)).rejects.toThrow()
    await nothingWritten(db)
  })

  it('refuses a crafted workspace restore before queueing anything for the other members', async () => {
    const db = await seedTarget()
    const payload = payloadOf({ ...base(), transactions: [leg('out', 'A', 'in'), leg('in', 'A', 'out')] })

    await expect(
      restoreLocalBackup(db, payload, { userId: 'u2', targetWorkspaceId: 'w1' })
    ).rejects.toThrow()
    await nothingWritten(db)
  })

  it('takes a goal amount from its contributions, not from the file, and says so', async () => {
    const db = await seedTarget()
    const result = await restore(
      db,
      payloadOf({
        savingsGoals: [{ id: 'g', name: 'Fund', targetAmount: 100000, currentAmount: 99999, currency: 'USD', status: 'active' }],
        savingsGoalContributions: [
          { id: 'c1', goalId: 'g', amount: 500, type: 'manual', contributedAt: NOW },
          { id: 'c2', goalId: 'g', amount: 250, type: 'manual', contributedAt: NOW },
        ],
      })
    )

    const [goal] = await goalsRepo.list(db)
    expect(goal.currentAmount).toBe(750)
    expect(goal.status).toBe('active')
    expect(result.warnings?.join(' ')).toMatch(/recalculated/i)
  })

  it('completes a goal whose contributions reach the target and reopens one that falls short', async () => {
    const db = await seedTarget()
    await restore(
      db,
      payloadOf({
        savingsGoals: [
          { id: 'met', name: 'Met', targetAmount: 500, currentAmount: 0, currency: 'USD', status: 'active' },
          { id: 'short', name: 'Short', targetAmount: 5000, currentAmount: 5000, currency: 'USD', status: 'completed' },
        ],
        savingsGoalContributions: [{ id: 'c', goalId: 'met', amount: 500, type: 'manual', contributedAt: NOW }],
      })
    )

    const goals = await goalsRepo.list(db)
    expect(goals.find((goal) => goal.name === 'Met')?.status).toBe('completed')
    expect(goals.find((goal) => goal.name === 'Short')?.status).toBe('active')
    expect(goals.find((goal) => goal.name === 'Short')?.currentAmount).toBe(0)
  })

  it('derives hasSplitChildren from the restored lines, not from the file', async () => {
    const db = await seedTarget()
    await restore(
      db,
      payloadOf({
        ...base(),
        transactions: [
          txRecord('lonely', 'A', { title: 'Lonely', hasSplitChildren: true }),
          txRecord('p', 'A', { title: 'Parent', amount: 1000 }),
          split('c1', 600, 'p', { title: 'Parent' }),
          split('c2', 400, 'p', { title: 'Parent' }),
        ],
      })
    )

    const rows = await transactionsRepo.list(db)
    expect(rows.find((row) => row.title === 'Lonely')?.hasSplitChildren).toBeFalsy()
    expect(rows.find((row) => row.title === 'Parent' && !row.splitTransactionId)?.hasSplitChildren).toBe(true)
  })

  it('takes the account currency for a transaction that carries none', async () => {
    const db = await seedTarget()
    await restore(db, payloadOf({ ...base(), transactions: [txRecord('t', 'A', { currency: undefined })] }))

    expect(await transactionsRepo.list(db)).toHaveLength(1)
  })

  it('restores rules, templates and recurring rules that sit exactly on the bounds', async () => {
    const db = await seedTarget()
    await restore(
      db,
      payloadOf({
        ...base(),
        categorizationRules: [
          rule({ id: 'k1', name: 'Long', matchValue: 'x'.repeat(200) }),
          rule({ id: 'k2', name: 'Range', matchType: 'amount_range', matchValue: undefined, amountMin: 100, amountMax: 100 }),
        ],
        transactionTemplates: [template({ amount: 1 })],
        recurringRules: [recurring({ amount: 1, interval: 'custom', customIntervalDays: 1 })],
      })
    )

    expect(await rulesRepo.list(db)).toHaveLength(2)
  })
})
