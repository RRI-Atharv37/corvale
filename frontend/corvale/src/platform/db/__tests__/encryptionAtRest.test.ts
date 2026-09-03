import { describe, expect, it } from 'vitest'
import { MemorySqliteDriver } from '../MemorySqliteDriver'
import { runMigrations } from '../migrations/runMigrations'
import { MIGRATIONS } from '../migrations/schema'
import { Repository } from '../repositories/Repository'
import { generateLocalObjectId } from '../generateLocalId'
import type { LocalDb } from '../LocalDb'
import type { LocalTransaction } from '@domain/types'

/**
 * Acceptance spec for browser local-DB encryption (S8, SEC-01).
 *
 * SEC-01: the AES-GCM primitives in `db/encryption/deriveKey.ts` (PBKDF2-SHA256, 210k
 * iterations, correct per the audit) are never actually called by anything that writes to the
 * local store - `Repository.ts` and the migration schema write plain JSON regardless of whether
 * a PIN/passphrase key has been set. Full transaction titles, descriptions, and amounts sit in
 * cleartext OPFS SQLite.
 *
 * Contract assumed here, following SEC-01's option (a) (wire the sensitive columns through the
 * existing primitives) rather than option (b) (swap in a SQLite3MultipleCiphers WASM build - a
 * longer-term preference but a separate, larger migration of the WASM dependency itself): every
 * syncable table's `data` column - the full server-document JSON blob - is encrypted at rest
 * whenever the driver holds an active key, while the *promoted* columns (`amount`, `date`,
 * `accountId`, `status`, ...) stay plaintext, because those are exactly the columns the local
 * domain/report engine filters and `SUM`s on in SQL - the thing per-field encryption must not
 * break. `data` itself is only ever read by `_id` (see `Repository.findById`/`list`), never
 * filtered on, so encrypting the whole blob
 * costs nothing there while closing the actual finding: titles, descriptions, notes, and tags -
 * the human-readable financial detail - no longer sit in cleartext.
 *
 * `MemorySqliteDriver` (what every local-store test runs against - see its own file header) gains
 * the same encryption surface `SqliteWasmDriver`/`TauriSqlDriver` already duck-type against in
 * `offline/pinStorage.ts`'s `EncryptionCapableDb`, implemented directly against `deriveKey`/
 * `encryptField`/`decryptField` since `MemorySqliteDriver` runs on the main thread (no worker
 * boundary to cross):
 *
 *   setEncryptionKey(passphrase: string, salt: Uint8Array): Promise<void>
 *   hasEncryptionKey(): boolean
 *   clearEncryptionKey(): void
 *
 * `Repository.ts` checks `hasEncryptionKey()` (duck-typed, exactly like `pinStorage.ts` already
 * does) before every write/read of `data`: with no key configured (local-first PIN never set up)
 * behavior is byte-for-byte what it is today - a deliberate compatibility path, since forcing
 * encryption before a PIN exists would leave a key nobody can reproduce. With a key configured,
 * reading with the wrong/absent key must fail closed (reject), never silently return corrupted
 * or partially-decrypted data.
 */

interface EncryptionCapableDriver extends LocalDb {
  setEncryptionKey(passphrase: string, salt: Uint8Array): Promise<void>
  hasEncryptionKey(): boolean
  clearEncryptionKey(): void
}

const asEncryptable = (db: LocalDb): EncryptionCapableDriver => db as unknown as EncryptionCapableDriver

const freshDb = async (): Promise<LocalDb> => {
  const db = await MemorySqliteDriver.create()
  await runMigrations(db, MIGRATIONS)
  return db
}

const randomSalt = (): Uint8Array => crypto.getRandomValues(new Uint8Array(16))

const buildTransaction = (overrides: Partial<LocalTransaction> = {}): LocalTransaction => ({
  _id: generateLocalObjectId(),
  userId: 'user-1',
  accountId: 'acc-1',
  categoryId: 'cat-1',
  type: 'expense',
  status: 'posted',
  amount: 4599,
  title: 'Therapy session copay',
  description: 'Weekly session - Dr. Alvarez',
  date: '2026-03-01T00:00:00.000Z',
  splitTransactionId: null,
  updatedAt: new Date().toISOString(),
  ...overrides,
})

describe('Local DB encryption at rest (S8, SEC-01)', () => {
  it('does not persist the plaintext title/description once an encryption key is set', async () => {
    const db = await freshDb()
    await asEncryptable(db).setEncryptionKey('correct horse battery staple', randomSalt())

    const repo = new Repository<LocalTransaction>('transactions')
    const record = buildTransaction()
    await db.transaction(async (tx) => repo.create(tx, record))

    const rows = await db.select<{ data: string }>('SELECT data FROM transactions WHERE _id = ?', [record._id])
    expect(rows).toHaveLength(1)
    expect(rows[0].data).not.toContain(record.title)
    expect(rows[0].data).not.toContain(record.description)

    await db.close()
  })

  it('round-trips the original plaintext back out through findById', async () => {
    const db = await freshDb()
    await asEncryptable(db).setEncryptionKey('pin-1234', randomSalt())

    const repo = new Repository<LocalTransaction>('transactions')
    const record = buildTransaction({ title: 'Confidential medical expense' })
    await db.transaction(async (tx) => repo.create(tx, record))

    const found = await repo.findById(db, record._id)
    expect(found?.title).toBe('Confidential medical expense')
    expect(found?.description).toBe(record.description)

    await db.close()
  })

  it('round-trips through list() too', async () => {
    const db = await freshDb()
    await asEncryptable(db).setEncryptionKey('pin-5678', randomSalt())

    const repo = new Repository<LocalTransaction>('transactions')
    const record = buildTransaction({ title: 'Second opinion consult' })
    await db.transaction(async (tx) => repo.create(tx, record))

    const listed = await repo.list(db)
    expect(listed).toHaveLength(1)
    expect(listed[0].title).toBe('Second opinion consult')

    await db.close()
  })

  it('keeps promoted columns (amount, accountId, date) plaintext and queryable for local aggregation', async () => {
    const db = await freshDb()
    await asEncryptable(db).setEncryptionKey('pin-9999', randomSalt())

    const repo = new Repository<LocalTransaction>('transactions')
    const record = buildTransaction({ amount: 12345, accountId: 'acc-42' })
    await db.transaction(async (tx) => repo.create(tx, record))

    const rows = await db.select<{ amount: number; accountId: string }>(
      'SELECT amount, accountId FROM transactions WHERE _id = ?',
      [record._id]
    )
    expect(rows[0]).toMatchObject({ amount: 12345, accountId: 'acc-42' })

    const sumRows = await db.select<{ total: number }>('SELECT SUM(amount) as total FROM transactions')
    expect(sumRows[0].total).toBe(12345)

    await db.close()
  })

  it('fails closed rather than returning plaintext-or-garbage when the key is cleared mid-session', async () => {
    const db = await freshDb()
    const encryptable = asEncryptable(db)
    await encryptable.setEncryptionKey('pin-0001', randomSalt())

    const repo = new Repository<LocalTransaction>('transactions')
    const record = buildTransaction()
    await db.transaction(async (tx) => repo.create(tx, record))

    encryptable.clearEncryptionKey()

    await expect(repo.findById(db, record._id)).rejects.toThrow()

    await db.close()
  })

  it('keeps storing plaintext when no encryption key has ever been set (back-compat, no PIN configured)', async () => {
    const db = await freshDb()
    const repo = new Repository<LocalTransaction>('transactions')
    const record = buildTransaction()
    await db.transaction(async (tx) => repo.create(tx, record))

    const rows = await db.select<{ data: string }>('SELECT data FROM transactions WHERE _id = ?', [record._id])
    expect(rows[0].data).toContain(record.title)

    const found = await repo.findById(db, record._id)
    expect(found?.title).toBe(record.title)

    await db.close()
  })
})
