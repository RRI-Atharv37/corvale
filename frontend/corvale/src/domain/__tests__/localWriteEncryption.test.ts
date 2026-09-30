import { afterEach, describe, expect, it } from 'vitest'
import { MemorySqliteDriver } from '@platform/db/MemorySqliteDriver'
import { runMigrations } from '@platform/db/migrations/runMigrations'
import { MIGRATIONS } from '@platform/db/migrations/schema'
import { Repository } from '@platform/db/repositories/Repository'
import { isEncryptedField } from '@platform/db/encryption/serialization'
import type { LocalDb } from '@platform/db/LocalDb'
import { persistLocalAccountBalance, recomputeAllLocalAccountBalances } from '../accountBalances'
import { bulkApplyLocalCategorizationRules } from '../categorizationRules'
import { commitLocalImport } from '../importTransactions'
import { createLocalSplitExpense } from '../splits'
import { createLocalTransfer } from '../transfers'
import type { LocalAccount, LocalCategorizationRule, LocalCategory, LocalTransaction } from '../types'

/**
 * SEC-88 (S55): six local write paths used to store the `data` blob with a bare `JSON.stringify`,
 * bypassing the at-rest encryption `Repository` applies whenever the driver holds a key. A plaintext
 * row reads back fine, so nothing failed - it just sat readable in OPFS. With a key configured,
 * every one of these paths must leave an encrypted blob, with the plaintext values still readable
 * through `Repository` and the promoted columns still plaintext for SQL aggregation.
 * (The transactions page balance helper and the quick-add template apply now share
 * `persistLocalAccountBalance`, so the first case covers them too.)
 */

interface EncryptableDb extends LocalDb {
  setEncryptionKey(passphrase: string, salt: Uint8Array): Promise<void>
}

const accountsRepo = new Repository<LocalAccount>('accounts')
const transactionsRepo = new Repository<LocalTransaction>('transactions')
const categoriesRepo = new Repository<LocalCategory>('categories')
const rulesRepo = new Repository<LocalCategorizationRule>('categorizationRules')

const nowIso = () => new Date().toISOString()

const keyedDb = async (): Promise<LocalDb> => {
  const db = await MemorySqliteDriver.create()
  await runMigrations(db, MIGRATIONS)
  await (db as unknown as EncryptableDb).setEncryptionKey('pin-1357', crypto.getRandomValues(new Uint8Array(16)))
  return db
}

const expectEveryBlobEncrypted = async (db: LocalDb, tables: string[]): Promise<void> => {
  for (const table of tables) {
    const rows = await db.select<{ data: string }>(`SELECT data FROM ${table}`)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(isEncryptedField(row.data)).toBe(true)
    }
  }
}

const seedAccounts = async (db: LocalDb) => {
  await accountsRepo.upsertFromServer(db, [
    { _id: 'acc-1', updatedAt: nowIso(), userId: 'u1', name: 'Checking', type: 'checking', currency: 'USD', currentBalance: 1000, openingBalance: 1000, isArchived: false },
    { _id: 'acc-2', updatedAt: nowIso(), userId: 'u1', name: 'Savings', type: 'savings', currency: 'USD', currentBalance: 500, openingBalance: 500, isArchived: false },
  ])
  await categoriesRepo.upsertFromServer(db, [
    { _id: 'cat-other', updatedAt: nowIso(), userId: null, masterCategoryId: null, name: 'Other', isArchived: false },
    { _id: 'cat-food', updatedAt: nowIso(), userId: 'u1', masterCategoryId: null, name: 'Food', isArchived: false },
  ])
}

describe('local write paths keep the data blob encrypted (SEC-88)', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
  })

  it('persistLocalAccountBalance', async () => {
    const db = await keyedDb()
    await seedAccounts(db)
    await transactionsRepo.upsertFromServer(db, [
      { _id: 'tx-1', updatedAt: nowIso(), userId: 'u1', accountId: 'acc-1', categoryId: 'cat-food', type: 'expense', status: 'posted', amount: 20000, title: 'Rent deposit', date: '2026-01-06T00:00:00.000Z', splitTransactionId: null },
    ])

    const balance = await persistLocalAccountBalance(db, 'acc-1')

    expect(balance).toBe(800)
    await expectEveryBlobEncrypted(db, ['accounts'])
    expect((await accountsRepo.findById(db, 'acc-1'))?.currentBalance).toBe(800)
    const column = await db.select<{ currentBalance: number }>('SELECT currentBalance FROM accounts WHERE _id = ?', ['acc-1'])
    expect(column[0].currentBalance).toBe(800)
  })

  it('persistLocalAccountBalance does not flag the row for push or touch its updatedAt', async () => {
    const db = await keyedDb()
    await seedAccounts(db)
    const before = await db.select<{ updatedAt: string; _dirty: number; _syncState: string }>(
      'SELECT updatedAt, _dirty, _syncState FROM accounts WHERE _id = ?',
      ['acc-1']
    )

    await persistLocalAccountBalance(db, 'acc-1')

    const after = await db.select<{ updatedAt: string; _dirty: number; _syncState: string }>(
      'SELECT updatedAt, _dirty, _syncState FROM accounts WHERE _id = ?',
      ['acc-1']
    )
    expect(after[0]).toEqual(before[0])
    expect(await db.select('SELECT opId FROM _outbox')).toHaveLength(0)
  })

  it('recomputeAllLocalAccountBalances', async () => {
    const db = await keyedDb()
    await seedAccounts(db)

    await recomputeAllLocalAccountBalances(db)

    await expectEveryBlobEncrypted(db, ['accounts'])
  })

  it('createLocalTransfer', async () => {
    const db = await keyedDb()
    await seedAccounts(db)

    await createLocalTransfer(db, { userId: 'u1', title: 'Move money', amount: 200, date: '2026-05-01', fromAccountId: 'acc-1', toAccountId: 'acc-2' })

    await expectEveryBlobEncrypted(db, ['accounts', 'transactions'])
  })

  it('createLocalSplitExpense', async () => {
    const db = await keyedDb()
    await seedAccounts(db)

    await createLocalSplitExpense(db, {
      userId: 'u1',
      title: 'Grocery run',
      amount: 150,
      date: '2026-05-01',
      accountId: 'acc-1',
      splits: [
        { categoryId: 'cat-food', amount: 100 },
        { categoryId: 'cat-other', amount: 50 },
      ],
    })

    await expectEveryBlobEncrypted(db, ['accounts', 'transactions'])
  })

  it('commitLocalImport', async () => {
    const db = await keyedDb()
    await seedAccounts(db)

    await commitLocalImport(db, {
      userId: 'u1',
      accountId: 'acc-1',
      defaultCategoryId: 'cat-food',
      headers: ['Date', 'Description', 'Amount'],
      rows: [['2026-01-05', 'Grocery Store', '-45.50']],
      mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
    })

    await expectEveryBlobEncrypted(db, ['accounts', 'transactions'])
  })

  it('bulkApplyLocalCategorizationRules', async () => {
    const db = await keyedDb()
    await seedAccounts(db)
    await rulesRepo.upsertFromServer(db, [
      { _id: 'rule-1', updatedAt: nowIso(), userId: 'u1', name: 'Food', matchType: 'description_contains', matchValue: 'grocery', categoryId: 'cat-food', priority: 0, isActive: true },
    ])
    await transactionsRepo.upsertFromServer(db, [
      { _id: 'tx-1', updatedAt: nowIso(), userId: 'u1', workspaceId: null, accountId: 'acc-1', categoryId: 'cat-other', type: 'expense', status: 'posted', amount: 500, title: 'Grocery', date: '2026-01-01T00:00:00.000Z', splitTransactionId: null },
    ])

    expect((await bulkApplyLocalCategorizationRules(db)).updated).toBe(1)

    await expectEveryBlobEncrypted(db, ['transactions'])
  })
})
