import { describe, expect, it } from 'vitest'
import { MemorySqliteDriver } from '@platform/db/MemorySqliteDriver'
import { runMigrations } from '@platform/db/migrations/runMigrations'
import { MIGRATIONS } from '@platform/db/migrations/schema'
import { Repository } from '@platform/db/repositories/Repository'
import { isEncryptedField } from '@platform/db/encryption/serialization'
import type { LocalDb } from '@platform/db/LocalDb'
import { bulkApplyLocalCategorizationRules } from '../categorizationRules'
import type { LocalCategorizationRule, LocalTransaction } from '../types'

/**
 * BUG-75 (S55): the local "Apply rules to existing transactions" used to rewrite rows with a raw
 * `UPDATE ... _dirty = 1` and no outbox op, so nothing reached the server and the next pull of a
 * touched row undid it. It now goes through `Repository.update` (one outbox op per changed row) and,
 * like the server's `bulkApplyCategorizationRules` (`workspaceId: null`), leaves shared-workspace
 * rows alone.
 */

const freshDb = async (): Promise<LocalDb> => {
  const db = await MemorySqliteDriver.create()
  await runMigrations(db, MIGRATIONS)
  return db
}

const nowIso = () => new Date().toISOString()
const rulesRepo = new Repository<LocalCategorizationRule>('categorizationRules')
const transactionsRepo = new Repository<LocalTransaction>('transactions')

type OutboxRow = {
  entity: string
  operation: string
  payload: string
  baseUpdatedAt: string | null
}

const readOutbox = (db: LocalDb): Promise<OutboxRow[]> =>
  db.select<OutboxRow>('SELECT entity, operation, payload, baseUpdatedAt FROM _outbox ORDER BY createdAt')

const seed = async (db: LocalDb) => {
  await rulesRepo.upsertFromServer(db, [
    { _id: 'rule-coffee', updatedAt: nowIso(), userId: 'u1', name: 'Coffee', matchType: 'description_contains', matchValue: 'coffee', categoryId: 'cat-coffee', tags: ['caffeine'], priority: 0, isActive: true },
  ])
  const serverUpdatedAt = '2026-01-01T00:00:00.000Z'
  await transactionsRepo.upsertFromServer(db, [
    { _id: 'tx-personal', updatedAt: serverUpdatedAt, userId: 'u1', workspaceId: null, accountId: 'acc-p', categoryId: 'cat-other', type: 'expense', status: 'posted', amount: 500, title: 'Coffee run', date: '2026-01-01T00:00:00.000Z', splitTransactionId: null },
    { _id: 'tx-personal-ok', updatedAt: serverUpdatedAt, userId: 'u1', workspaceId: null, accountId: 'acc-p', categoryId: 'cat-coffee', tags: ['caffeine'], type: 'expense', status: 'posted', amount: 500, title: 'Coffee beans', date: '2026-01-02T00:00:00.000Z', splitTransactionId: null },
    { _id: 'tx-shared-mine', updatedAt: serverUpdatedAt, userId: 'u1', workspaceId: 'ws-1', accountId: 'acc-w', categoryId: 'cat-other', type: 'expense', status: 'posted', amount: 500, title: 'Coffee for the team', date: '2026-01-03T00:00:00.000Z', splitTransactionId: null },
    { _id: 'tx-shared-theirs', updatedAt: serverUpdatedAt, userId: 'u2', workspaceId: 'ws-1', accountId: 'acc-w', categoryId: 'cat-other', type: 'expense', status: 'posted', amount: 500, title: 'Coffee from a teammate', date: '2026-01-04T00:00:00.000Z', splitTransactionId: null },
  ])
  return { serverUpdatedAt }
}

describe('bulkApplyLocalCategorizationRules (BUG-75)', () => {
  it('queues one update op per changed personal row and none for shared-workspace rows', async () => {
    const db = await freshDb()
    const { serverUpdatedAt } = await seed(db)

    const result = await bulkApplyLocalCategorizationRules(db)
    expect(result).toEqual({ updated: 1, skipped: 1 })

    const ops = await readOutbox(db)
    expect(ops).toHaveLength(1)
    expect(ops[0].entity).toBe('transaction:tx-personal')
    expect(ops[0].operation).toBe('update')
    expect(ops[0].baseUpdatedAt).toBe(serverUpdatedAt)
    expect(JSON.parse(ops[0].payload)).toMatchObject({ _id: 'tx-personal', categoryId: 'cat-coffee', tags: ['caffeine'] })

    expect((await transactionsRepo.findById(db, 'tx-shared-mine'))?.categoryId).toBe('cat-other')
    expect((await transactionsRepo.findById(db, 'tx-shared-theirs'))?.categoryId).toBe('cat-other')
  })

  it('leaves the touched row pending so a pull of the stale server copy does not undo it', async () => {
    const db = await freshDb()
    const { serverUpdatedAt } = await seed(db)

    await bulkApplyLocalCategorizationRules(db)

    const rows = await db.select<{ _syncState: string; _dirty: number; categoryId: string }>(
      'SELECT _syncState, _dirty, categoryId FROM transactions WHERE _id = ?',
      ['tx-personal']
    )
    expect(rows[0]).toMatchObject({ _syncState: 'pending', _dirty: 1, categoryId: 'cat-coffee' })

    await transactionsRepo.upsertFromServer(db, [
      { _id: 'tx-personal', updatedAt: serverUpdatedAt, userId: 'u1', workspaceId: null, accountId: 'acc-p', categoryId: 'cat-other', type: 'expense', status: 'posted', amount: 500, title: 'Coffee run', date: '2026-01-01T00:00:00.000Z', splitTransactionId: null },
    ])
    expect((await transactionsRepo.findById(db, 'tx-personal'))?.categoryId).toBe('cat-coffee')
  })

  it('reports zero updates and queues nothing when only shared rows would match', async () => {
    const db = await freshDb()
    await rulesRepo.upsertFromServer(db, [
      { _id: 'rule-coffee', updatedAt: nowIso(), userId: 'u1', name: 'Coffee', matchType: 'description_contains', matchValue: 'coffee', categoryId: 'cat-coffee', priority: 0, isActive: true },
    ])
    await transactionsRepo.upsertFromServer(db, [
      { _id: 'tx-shared', updatedAt: nowIso(), userId: 'u1', workspaceId: 'ws-1', accountId: 'acc-w', categoryId: 'cat-other', type: 'expense', status: 'posted', amount: 500, title: 'Coffee', date: '2026-01-03T00:00:00.000Z', splitTransactionId: null },
    ])

    expect(await bulkApplyLocalCategorizationRules(db)).toEqual({ updated: 0, skipped: 0 })
    expect(await readOutbox(db)).toHaveLength(0)
  })

  it('writes the rewritten transaction encrypted when a key is configured (SEC-88)', async () => {
    const db = await freshDb()
    await seed(db)
    await (db as unknown as { setEncryptionKey(p: string, s: Uint8Array): Promise<void> }).setEncryptionKey(
      'pin-2468',
      crypto.getRandomValues(new Uint8Array(16))
    )

    await bulkApplyLocalCategorizationRules(db)

    const rows = await db.select<{ data: string }>('SELECT data FROM transactions WHERE _id = ?', ['tx-personal'])
    expect(isEncryptedField(rows[0].data)).toBe(true)
    expect(rows[0].data).not.toContain('Coffee run')
  })
})
