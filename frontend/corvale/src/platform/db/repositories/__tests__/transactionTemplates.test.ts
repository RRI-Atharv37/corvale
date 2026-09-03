import { describe, expect, it } from 'vitest'
import { MemorySqliteDriver } from '../../MemorySqliteDriver'
import { runMigrations } from '../../migrations/runMigrations'
import { MIGRATIONS } from '../../migrations/schema'
import { Repository } from '../Repository'
import type { LocalTransactionTemplate } from '@domain/types'
import { generateLocalObjectId } from '../../generateLocalId'

/**
 * Sprint 13.9: `transactionTemplates` was never added to the sync surface in
 * 13.2/13.3/13.5 even though the backend model already supported it - see
 * `db/migrations/sql/0003_transaction_templates.sql`. This proves migration
 * 0003 creates a working table the generic Repository can read/write.
 */
describe('transactionTemplates local table (migration 0003)', () => {
  const freshDb = async () => {
    const db = await MemorySqliteDriver.create()
    await runMigrations(db, MIGRATIONS)
    return db
  }

  it('round-trips a create through the repository and lists it back', async () => {
    const db = await freshDb()
    const repo = new Repository<LocalTransactionTemplate>('transactionTemplates')

    const template: LocalTransactionTemplate = {
      _id: generateLocalObjectId(),
      userId: 'user-1',
      name: 'Coffee',
      type: 'expense',
      amount: 500,
      accountId: 'acc-1',
      categoryId: 'cat-1',
      updatedAt: new Date().toISOString(),
    }

    await db.transaction(async (tx) => {
      await repo.create(tx, template)
    })

    const found = await repo.findById(db, template._id)
    expect(found).toMatchObject({ _id: template._id, name: 'Coffee', amount: 500 })

    const listed = await repo.list(db)
    expect(listed).toHaveLength(1)

    await db.close()
  })

  it('excludes a soft-deleted template from list/findById', async () => {
    const db = await freshDb()
    const repo = new Repository<LocalTransactionTemplate>('transactionTemplates')
    const template: LocalTransactionTemplate = {
      _id: generateLocalObjectId(),
      userId: 'user-1',
      name: 'Rent',
      type: 'expense',
      amount: 150000,
      accountId: 'acc-1',
      categoryId: 'cat-1',
      updatedAt: new Date().toISOString(),
    }

    await db.transaction(async (tx) => {
      await repo.create(tx, template)
    })
    await db.transaction(async (tx) => {
      await repo.remove(tx, template._id)
    })

    expect(await repo.findById(db, template._id)).toBeNull()
    expect(await repo.list(db)).toHaveLength(0)

    await db.close()
  })
})
