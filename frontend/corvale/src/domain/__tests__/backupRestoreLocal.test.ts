import { describe, expect, it } from 'vitest'
import { MemorySqliteDriver } from '@platform/db/MemorySqliteDriver'
import { runMigrations } from '@platform/db/migrations/runMigrations'
import { MIGRATIONS } from '@platform/db/migrations/schema'
import { Repository } from '@platform/db/repositories/Repository'
import { createSqliteOutboxStore } from '@platform/sync/sqliteOutboxStore'
import type { LocalDb } from '@platform/db/LocalDb'
import type { LocalAccount, LocalCategory, LocalTransaction } from '../types'
import { restoreLocalBackup, type CorvaleBackupPayload } from '../backup'

/**
 * S49 / BUG-62 + BUG-63: a backup restored on the desktop must queue ops the server accepts -
 * transfers as one grouped `transaction.transfer` op, a split as one create carrying `splits`,
 * accounts without a client-set `currentBalance` - and must read a minor-unit account balance in
 * the right unit. Server half: `backend/src/modules/backup/__tests__/backupLocalRestoreSync.test.ts`.
 */

const freshDb = async (): Promise<LocalDb> => {
  const db = await MemorySqliteDriver.create()
  await runMigrations(db, MIGRATIONS)
  return db
}

const accountsRepo = new Repository<LocalAccount>('accounts')
const categoriesRepo = new Repository<LocalCategory>('categories')
const transactionsRepo = new Repository<LocalTransaction & { hasSplitChildren?: boolean }>('transactions')

const MASTER_ID = 'master-food'
const nowIso = () => new Date().toISOString()

const seedTarget = async (): Promise<LocalDb> => {
  const db = await freshDb()
  await categoriesRepo.upsertFromServer(db, [
    { _id: MASTER_ID, updatedAt: nowIso(), userId: null, masterCategoryId: null, name: 'Food', isArchived: false },
  ])
  return db
}

const emptyCounts = () => ({
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
})

const payloadOf = (overrides: Partial<CorvaleBackupPayload>): CorvaleBackupPayload => ({
  version: 1,
  exportedAt: '2026-02-01T00:00:00.000Z',
  scope: { workspaceId: null },
  counts: emptyCounts(),
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

const accountRecord = (id: string, name: string, type: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name,
  type,
  currency: 'USD',
  openingBalance: 1000,
  currentBalance: 1000,
  isArchived: false,
  ...overrides,
})

const txRecord = (id: string, accountId: string, overrides: Record<string, unknown> = {}) => ({
  id,
  accountId,
  categoryId: MASTER_ID,
  type: 'expense',
  status: 'posted',
  amount: 2250,
  currency: 'USD',
  title: 'Groceries',
  date: '2026-01-15T12:00:00.000Z',
  createdAt: '2026-01-15T12:00:00.000Z',
  ...overrides,
})

const ledgerPayload = (): CorvaleBackupPayload => {
  const tie = '2026-01-16T12:00:00.000Z'
  return payloadOf({
    accounts: [
      accountRecord('a-check', 'Checking', 'checking'),
      accountRecord('a-save', 'Savings', 'savings', { openingBalance: 500, currentBalance: 600 }),
    ],
    transactions: [
      txRecord('t-exp', 'a-check'),
      txRecord('t-out', 'a-check', {
        type: 'transfer',
        amount: 10000,
        title: 'Move to savings',
        date: tie,
        createdAt: tie,
        transferPairId: 't-in',
      }),
      txRecord('t-in', 'a-save', {
        type: 'transfer',
        amount: 10000,
        title: 'Move to savings',
        date: tie,
        createdAt: tie,
        transferPairId: 't-out',
      }),
      txRecord('t-parent', 'a-check', {
        amount: 10000,
        title: 'Mixed shopping trip',
        date: '2026-01-17T12:00:00.000Z',
        createdAt: '2026-01-17T12:00:00.000Z',
        hasSplitChildren: true,
      }),
      txRecord('t-c1', 'a-check', {
        amount: 6000,
        title: 'Mixed shopping trip',
        date: '2026-01-17T12:00:00.000Z',
        createdAt: '2026-01-17T12:00:00.001Z',
        splitTransactionId: 't-parent',
      }),
      txRecord('t-c2', 'a-check', {
        amount: 4000,
        title: 'Mixed shopping trip',
        date: '2026-01-17T12:00:00.000Z',
        createdAt: '2026-01-17T12:00:00.002Z',
        splitTransactionId: 't-parent',
      }),
    ],
  })
}

const restore = (db: LocalDb, payload: CorvaleBackupPayload) =>
  restoreLocalBackup(db, payload, { userId: 'u2', targetWorkspaceId: null })

describe('restoreLocalBackup - sync ops (BUG-62)', () => {
  it('queues a transfer as one grouped op and never as per-leg creates', async () => {
    const db = await seedTarget()
    await restore(db, ledgerPayload())

    const ops = await createSqliteOutboxStore(db).list()
    const transferOps = ops.filter((op) => op.payload.intent === 'transaction.transfer')
    expect(transferOps).toHaveLength(1)

    const restoredAccounts = await accountsRepo.list(db)
    const checking = restoredAccounts.find((a) => a.name === 'Checking')
    const savings = restoredAccounts.find((a) => a.name === 'Savings')
    const legs = (await transactionsRepo.list(db)).filter((t) => t.type === 'transfer')
    expect(legs).toHaveLength(2)
    const outbound = legs.find((t) => t.accountId === checking?._id)
    const inbound = legs.find((t) => t.accountId === savings?._id)

    expect(transferOps[0].payload).toMatchObject({
      _id: outbound?._id,
      pairId: inbound?._id,
      amount: 10000,
      fromAccountId: checking?._id,
      toAccountId: savings?._id,
      title: 'Move to savings',
    })
    expect(outbound?.transferPairId).toBe(inbound?._id)
    expect(inbound?.transferPairId).toBe(outbound?._id)

    const legIds = new Set(legs.map((t) => t._id))
    const legCreates = ops.filter(
      (op) => op.entity.startsWith('transaction:') && legIds.has(String(op.payload._id)) && !op.payload.intent
    )
    expect(legCreates).toHaveLength(0)
    expect(ops.filter((op) => op.entity.startsWith('transaction:') && op.operation === 'update')).toHaveLength(0)
  })

  it('queues a split as one parent create carrying its lines, and no ops for the children', async () => {
    const db = await seedTarget()
    await restore(db, ledgerPayload())

    const rows = await transactionsRepo.list(db)
    const parent = rows.find((t) => t.title === 'Mixed shopping trip' && !t.splitTransactionId)
    const children = rows.filter((t) => t.splitTransactionId === parent?._id)
    expect(children).toHaveLength(2)
    expect(parent?.hasSplitChildren).toBe(true)

    const ops = await createSqliteOutboxStore(db).list()
    const splitOps = ops.filter((op) => Array.isArray(op.payload.splits))
    expect(splitOps).toHaveLength(1)
    expect(splitOps[0].payload._id).toBe(parent?._id)
    expect(splitOps[0].payload.amount).toBe(10000)
    const lines = splitOps[0].payload.splits as { _id: string; categoryId: string; amount: number }[]
    expect(lines.map((line) => line._id).sort()).toEqual(children.map((c) => c._id).sort())
    expect(lines.map((line) => line.amount).sort((a, b) => a - b)).toEqual([4000, 6000])

    const childIds = new Set(children.map((c) => c._id))
    expect(ops.filter((op) => childIds.has(String(op.payload._id)))).toHaveLength(0)
  })

  it('still queues an ordinary expense as a plain create', async () => {
    const db = await seedTarget()
    await restore(db, ledgerPayload())

    const ops = await createSqliteOutboxStore(db).list()
    const plain = ops.filter(
      (op) => op.entity.startsWith('transaction:') && op.operation === 'create' && op.payload.title === 'Groceries'
    )
    expect(plain).toHaveLength(1)
    expect(plain[0].payload.amount).toBe(2250)
  })

  it('keeps the first leg in the file as the outbound leg when both share a createdAt', async () => {
    const db = await seedTarget()
    await restore(db, ledgerPayload())

    const accounts = await accountsRepo.list(db)
    const checking = accounts.find((a) => a.name === 'Checking')
    const savings = accounts.find((a) => a.name === 'Savings')
    const legs = (await transactionsRepo.list(db)).filter((t) => t.type === 'transfer')
    const outbound = legs.find((t) => t.accountId === checking?._id)
    const inbound = legs.find((t) => t.accountId === savings?._id)

    expect(String(outbound?.createdAt) < String(inbound?.createdAt)).toBe(true)
    expect(savings?.currentBalance).toBe(600)
  })

  it('rejects a transfer leg whose pair is missing and writes nothing', async () => {
    const db = await seedTarget()
    const payload = ledgerPayload()
    payload.transactions = payload.transactions.filter((t) => t.id !== 't-in')

    await expect(restore(db, payload)).rejects.toThrow(/broken reference/i)
    expect(await accountsRepo.list(db)).toHaveLength(0)
    expect(await createSqliteOutboxStore(db).list()).toHaveLength(0)
  })

  it('rejects a split line whose parent is missing and writes nothing', async () => {
    const db = await seedTarget()
    const payload = ledgerPayload()
    payload.transactions = payload.transactions.filter((t) => t.id !== 't-parent')

    await expect(restore(db, payload)).rejects.toThrow(/broken reference/i)
    expect(await transactionsRepo.list(db)).toHaveLength(0)
  })

  it('ignores receipt ids, since receipt files are not restored locally', async () => {
    const db = await seedTarget()
    const payload = payloadOf({
      accounts: [accountRecord('a-check', 'Checking', 'checking')],
      transactions: [txRecord('t-exp', 'a-check', { receiptIds: ['r1'] })],
      receipts: [{ id: 'r1', originalFilename: 'r.png', storedFilename: 's.png' }],
    })

    await expect(restore(db, payload)).resolves.toBeDefined()
    const [row] = await transactionsRepo.list(db)
    expect((row as { receiptIds?: string[] }).receiptIds ?? []).toHaveLength(0)
  })

  it('restores a workspace backup transaction filed under a category copied from a co-member', async () => {
    const db = await seedTarget()
    const payload = payloadOf({
      categories: [{ id: 'c-copy', name: 'Editor private category', masterCategoryId: MASTER_ID }],
      accounts: [accountRecord('a-check', 'Checking', 'checking')],
      transactions: [txRecord('t-exp', 'a-check', { categoryId: 'c-copy' })],
    })

    await restore(db, payload)
    const categories = (await categoriesRepo.list(db)).filter((c) => c.userId === 'u2')
    const [row] = await transactionsRepo.list(db)
    expect(categories).toHaveLength(1)
    expect(row.categoryId).toBe(categories[0]._id)
  })
})

describe('restoreLocalBackup - categories missing from the file', () => {
  const MISSING_CATEGORY_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'

  const seedTargetWithOther = async (): Promise<LocalDb> => {
    const db = await seedTarget()
    await categoriesRepo.upsertFromServer(db, [
      { _id: 'master-other', updatedAt: nowIso(), userId: null, masterCategoryId: null, name: 'Other', isArchived: false },
    ])
    return db
  }

  it('files a transaction under Other when its category id looks real but is not in the file, and warns', async () => {
    const db = await seedTargetWithOther()
    const payload = payloadOf({
      accounts: [accountRecord('a-check', 'Checking', 'checking')],
      transactions: [txRecord('t-exp', 'a-check', { categoryId: MISSING_CATEGORY_ID })],
    })

    const result = await restore(db, payload)

    const [row] = await transactionsRepo.list(db)
    expect(row.categoryId).toBe('master-other')
    expect(result.warnings?.join(' ')).toMatch(/filed under Other/)
  })

  it('still rejects a category id that is not shaped like a real one', async () => {
    const db = await seedTargetWithOther()
    const payload = payloadOf({
      accounts: [accountRecord('a-check', 'Checking', 'checking')],
      transactions: [txRecord('t-exp', 'a-check', { categoryId: 'not-a-real-id' })],
    })

    await expect(restore(db, payload)).rejects.toThrow(/broken reference/i)
  })

  it('rejects a missing category when there is no Other category to file it under', async () => {
    const db = await seedTarget()
    const payload = payloadOf({
      accounts: [accountRecord('a-check', 'Checking', 'checking')],
      transactions: [txRecord('t-exp', 'a-check', { categoryId: MISSING_CATEGORY_ID })],
    })

    await expect(restore(db, payload)).rejects.toThrow(/broken reference/i)
  })
})

describe('restoreLocalBackup - transfer direction after restore (BUG-67)', () => {
  it('gives the two legs distinct creation times even when the file has none', async () => {
    const db = await seedTarget()
    const payload = ledgerPayload()
    payload.transactions = payload.transactions.map(({ createdAt: _createdAt, ...rest }) => rest)

    await restore(db, payload)

    const legs = (await transactionsRepo.list(db)).filter((t) => t.type === 'transfer')
    expect(legs).toHaveLength(2)
    expect(legs[0].createdAt).not.toBe(legs[1].createdAt)
    const accounts = await accountsRepo.list(db)
    expect(accounts.find((a) => a.name === 'Savings')?.currentBalance).toBeCloseTo(600, 2)
  })

  it('stores a role on each restored leg: outbound on the debited account, inbound on the credited one', async () => {
    const db = await seedTarget()

    await restore(db, ledgerPayload())

    const accounts = await accountsRepo.list(db)
    const checking = accounts.find((a) => a.name === 'Checking')
    const savings = accounts.find((a) => a.name === 'Savings')
    const legs = (await transactionsRepo.list(db)).filter((t) => t.type === 'transfer')
    expect(legs.find((t) => t.transferRole === 'out')?.accountId).toBe(checking?._id)
    expect(legs.find((t) => t.transferRole === 'in')?.accountId).toBe(savings?._id)
  })

  it("takes the file's own roles over creation order", async () => {
    const db = await seedTarget()
    const payload = ledgerPayload()
    payload.transactions = payload.transactions.map((record) =>
      record.type === 'transfer'
        ? {
            ...record,
            transferRole: record.id === 't-out' ? 'out' : 'in',
            createdAt: record.id === 't-out' ? '2026-03-01T00:00:00.000Z' : '2026-01-01T00:00:00.000Z',
          }
        : record
    )

    await restore(db, payload)

    const accounts = await accountsRepo.list(db)
    const checking = accounts.find((a) => a.name === 'Checking')
    const legs = (await transactionsRepo.list(db)).filter((t) => t.type === 'transfer')
    expect(legs.find((t) => t.transferRole === 'out')?.accountId).toBe(checking?._id)
    expect(accounts.find((a) => a.name === 'Savings')?.currentBalance).toBeCloseTo(600, 2)
  })
})

describe('restoreLocalBackup - account balances (BUG-63)', () => {
  it('reads a minor-unit account as major units, locally and in the queued op', async () => {
    const db = await seedTarget()
    const payload = payloadOf({
      accounts: [
        accountRecord('a-old', 'Migrated', 'checking', {
          balanceUnit: 'minor',
          openingBalance: 100000,
          currentBalance: 95000,
        }),
      ],
    })

    await restore(db, payload)

    const [account] = await accountsRepo.list(db)
    expect(account.openingBalance).toBe(1000)
    expect(account.currentBalance).toBe(1000)

    const op = (await createSqliteOutboxStore(db).list()).find((o) => o.entity.startsWith('account:'))
    expect(op?.payload.openingBalance).toBe(1000)
  })

  it('leaves a major-unit account as it is', async () => {
    const db = await seedTarget()
    const payload = payloadOf({
      accounts: [accountRecord('a-new', 'Plain', 'checking', { balanceUnit: 'major', openingBalance: 1000.5 })],
    })

    await restore(db, payload)

    const [account] = await accountsRepo.list(db)
    expect(account.openingBalance).toBe(1000.5)
  })

  it('does not send a client-set currentBalance with the account create op', async () => {
    const db = await seedTarget()
    await restore(db, ledgerPayload())

    const accountOps = (await createSqliteOutboxStore(db).list()).filter((op) => op.entity.startsWith('account:'))
    expect(accountOps).toHaveLength(2)
    for (const op of accountOps) {
      expect(op.payload).not.toHaveProperty('currentBalance')
    }
  })

  it('recomputes each restored account balance from the restored ledger', async () => {
    const db = await seedTarget()
    await restore(db, ledgerPayload())

    const accounts = await accountsRepo.list(db)
    const checking = accounts.find((a) => a.name === 'Checking')
    const savings = accounts.find((a) => a.name === 'Savings')
    expect(checking?.currentBalance).toBeCloseTo(1000 - 22.5 - 100 - 100, 2)
    expect(savings?.currentBalance).toBeCloseTo(600, 2)
  })
})
