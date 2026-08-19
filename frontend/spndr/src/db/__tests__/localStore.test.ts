import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { MemorySqliteDriver } from '../MemorySqliteDriver'
import type { LocalDb } from '../LocalDb'
// Sprint 13.4 deliverables — none of these modules exist yet. Per the project's
// test-first rule, these are the acceptance criteria for that sprint, written
// now against the `MemorySqliteDriver` built in 13.0. Expected to fail at
// module resolution until 13.4 lands; do not implement them here.
import { runMigrations, type Migration } from '../migrations/runMigrations'
import { deriveKey, encryptField, decryptField } from '../encryption/deriveKey'
import { tableInvalidationBus } from '../invalidation/tableInvalidationBus'
import { useLocalQuery } from '../useLocalQuery'

describe('schema migrations runner', () => {
  it('applies migrations in ascending version order starting from an empty database', async () => {
    const db = await MemorySqliteDriver.create()
    const migrations: Migration[] = [
      {
        version: 1,
        up: async (tx: LocalDb) => {
          await tx.exec(
            'CREATE TABLE transactions (id TEXT PRIMARY KEY, amount INTEGER NOT NULL, updatedAt TEXT NOT NULL, deletedAt TEXT, _localUpdatedAt TEXT NOT NULL, _dirty INTEGER NOT NULL DEFAULT 0, _syncState TEXT NOT NULL DEFAULT \'synced\')'
          )
        },
      },
      {
        version: 2,
        up: async (tx: LocalDb) => {
          await tx.exec("ALTER TABLE transactions ADD COLUMN notes TEXT NOT NULL DEFAULT ''")
        },
      },
    ]

    const result = await runMigrations(db, migrations)
    expect(result.toVersion).toBe(2)

    const columns = await db.select<{ name: string }>('PRAGMA table_info(transactions)')
    expect(columns.map((c) => c.name)).toEqual(
      expect.arrayContaining(['id', 'amount', 'updatedAt', 'deletedAt', '_localUpdatedAt', '_dirty', '_syncState', 'notes'])
    )
    await db.close()
  })

  it('migrating from schema v1 to v2 preserves existing rows and backfills the new column with its default', async () => {
    const db = await MemorySqliteDriver.create()
    const v1: Migration[] = [
      {
        version: 1,
        up: async (tx: LocalDb) => {
          await tx.exec('CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL)')
          await tx.exec('INSERT INTO accounts (id, name) VALUES (?, ?)', ['acc-1', 'Checking'])
        },
      },
    ]
    await runMigrations(db, v1)

    const v2: Migration[] = [
      ...v1,
      {
        version: 2,
        up: async (tx: LocalDb) => {
          await tx.exec("ALTER TABLE accounts ADD COLUMN _syncState TEXT NOT NULL DEFAULT 'synced'")
        },
      },
    ]
    await runMigrations(db, v2)

    const rows = await db.select<{ id: string; name: string; _syncState: string }>('SELECT * FROM accounts')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'acc-1', name: 'Checking', _syncState: 'synced' })
    await db.close()
  })

  it('re-running the same migration set against an already-migrated database is a no-op', async () => {
    const db = await MemorySqliteDriver.create()
    const migrations: Migration[] = [
      {
        version: 1,
        up: async (tx: LocalDb) => {
          await tx.exec('CREATE TABLE tags (id TEXT PRIMARY KEY)')
        },
      },
    ]
    await runMigrations(db, migrations)
    await expect(runMigrations(db, migrations)).resolves.not.toThrow()
    await db.close()
  })
})

describe('encryption round-trip', () => {
  it('derives an AES-GCM key from a passphrase and salt via PBKDF2-SHA256', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const key = await deriveKey('correct horse battery staple', salt)
    expect(key.algorithm.name).toBe('AES-GCM')
  })

  it('encrypting the same plaintext twice with the same key produces different ciphertext (random IV) but both decrypt back to the original', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const key = await deriveKey('a strong pin', salt)
    const plaintext = 'account balance: 1234.56'

    const first = await encryptField(key, plaintext)
    const second = await encryptField(key, plaintext)

    expect(first.iv).not.toEqual(second.iv)
    expect(first.ciphertext).not.toEqual(second.ciphertext)

    await expect(decryptField(key, first)).resolves.toBe(plaintext)
    await expect(decryptField(key, second)).resolves.toBe(plaintext)
  })

  it('fails to decrypt with the wrong key', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const rightKey = await deriveKey('right passphrase', salt)
    const wrongKey = await deriveKey('wrong passphrase', salt)
    const encrypted = await encryptField(rightKey, 'sensitive value')

    await expect(decryptField(wrongKey, encrypted)).rejects.toThrow()
  })
})

describe('table invalidation bus', () => {
  it('notifies a subscriber registered for the written table but not a subscriber registered for a different table', () => {
    const transactionsListener = vi.fn()
    const accountsListener = vi.fn()

    const unsubTransactions = tableInvalidationBus.subscribe('transactions', transactionsListener)
    const unsubAccounts = tableInvalidationBus.subscribe('accounts', accountsListener)

    tableInvalidationBus.publish('transactions')

    expect(transactionsListener).toHaveBeenCalledTimes(1)
    expect(accountsListener).not.toHaveBeenCalled()

    unsubTransactions()
    unsubAccounts()
  })

  it('stops notifying a subscriber after it unsubscribes', () => {
    const listener = vi.fn()
    const unsubscribe = tableInvalidationBus.subscribe('budgets', listener)
    unsubscribe()

    tableInvalidationBus.publish('budgets')

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('useLocalQuery', () => {
  it('returns the same {data, loading, error, refetch} shape as useAsyncData, starting in a loading state and then resolving', async () => {
    const fetcher = vi.fn(async (_db: LocalDb) => ({ total: 42 }))

    const { result } = renderHook(() => useLocalQuery('transactions', fetcher))

    expect(result.current).toEqual({ data: null, loading: true, error: null, refetch: expect.any(Function) })

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current).toEqual({ data: { total: 42 }, loading: false, error: null, refetch: expect.any(Function) })
  })

  it('surfaces a fetcher rejection as a non-null error string and clears loading', async () => {
    const fetcher = vi.fn(async (_db: LocalDb) => {
      throw new Error('local query failed')
    })

    const { result } = renderHook(() => useLocalQuery('transactions', fetcher))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeTruthy()
  })

  it('automatically refetches when the subscribed table is invalidated, without needing a window CustomEvent like the legacy useAsyncData bus', async () => {
    let callCount = 0
    const fetcher = vi.fn(async (_db: LocalDb) => {
      callCount += 1
      return { callCount }
    })

    const { result } = renderHook(() => useLocalQuery('transactions', fetcher))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ callCount: 1 })

    tableInvalidationBus.publish('transactions')

    await waitFor(() => expect(result.current.data).toEqual({ callCount: 2 }))
  })
})
