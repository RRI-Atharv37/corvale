import { describe, expect, it } from 'vitest'
import { MemorySqliteDriver } from '../MemorySqliteDriver'
import { runMigrations } from '../migrations/runMigrations'
import { MIGRATIONS } from '../migrations/schema'
import { Repository, type SyncableRecord } from '../repositories/Repository'
import { createSqliteOutboxStore } from '@platform/sync/sqliteOutboxStore'

/**
 * The server refuses a client-set `currentBalance` on an account create or update op ("server-derived"),
 * so the local row keeps it for the engine but the pushed payload must not carry it.
 */

interface LocalAccount extends SyncableRecord {
  userId: string
  workspaceId: string | null
  name: string
  type: string
  currency: string
  openingBalance: number
  currentBalance: number
  isArchived: boolean
}

const accountsRepo = new Repository<LocalAccount>('accounts')

const freshDb = async () => {
  const db = await MemorySqliteDriver.create()
  await runMigrations(db, MIGRATIONS)
  return db
}

const account = (overrides: Partial<LocalAccount> = {}): LocalAccount => ({
  _id: 'acc-1',
  updatedAt: '2026-05-01T00:00:00.000Z',
  userId: 'u1',
  workspaceId: null,
  name: 'Checking',
  type: 'checking',
  currency: 'USD',
  openingBalance: 100,
  currentBalance: 100,
  isArchived: false,
  ...overrides,
})

describe('Repository wire payload for server-derived fields', () => {
  it('keeps currentBalance on the local row but not on the create op', async () => {
    const db = await freshDb()
    await accountsRepo.create(db, account())

    const [op] = await createSqliteOutboxStore(db).list()
    expect(op.payload).not.toHaveProperty('currentBalance')
    expect(op.payload.openingBalance).toBe(100)
    expect((await accountsRepo.findById(db, 'acc-1'))?.currentBalance).toBe(100)
  })

  it('keeps currentBalance off an update op as well', async () => {
    const db = await freshDb()
    await accountsRepo.upsertFromServer(db, [account()])
    await accountsRepo.update(db, account({ name: 'Renamed', currentBalance: 250 }), '2026-05-01T00:00:00.000Z')

    const ops = await createSqliteOutboxStore(db).list()
    expect(ops).toHaveLength(1)
    expect(ops[0].operation).toBe('update')
    expect(ops[0].payload).not.toHaveProperty('currentBalance')
    expect(ops[0].payload.name).toBe('Renamed')
    expect((await accountsRepo.findById(db, 'acc-1'))?.currentBalance).toBe(250)
  })
})
