import type { LocalDb } from './LocalDb'
import { MemorySqliteDriver } from './MemorySqliteDriver'
import { runMigrations } from './migrations/runMigrations'
import { MIGRATIONS } from './migrations/schema'

/**
 * App-wide `LocalDb` singleton. The real app bootstraps this once with a
 * `SqliteWasmDriver` (OPFS-backed) via `setLocalDb`. Nothing that consumes
 * `getLocalDb` needs to know which driver is behind it - including tests,
 * which never call `setLocalDb` and so transparently get a fresh in-memory
 * `MemorySqliteDriver`, migrated to the current schema, with no OPFS/Worker
 * setup required.
 */
let instance: LocalDb | null = null
let pending: Promise<LocalDb> | null = null

const createDefaultLocalDb = async (): Promise<LocalDb> => {
  const db = await MemorySqliteDriver.create()
  await runMigrations(db, MIGRATIONS)
  return db
}

export const setLocalDb = (db: LocalDb): void => {
  instance = db
  pending = Promise.resolve(db)
}

export const getLocalDb = (): Promise<LocalDb> => {
  if (instance) {
    return Promise.resolve(instance)
  }
  if (!pending) {
    pending = createDefaultLocalDb().then((db) => {
      instance = db
      return db
    })
  }
  return pending
}

/** Test-only: forces the next `getLocalDb()` call to create a fresh instance. */
export const resetLocalDbForTests = (): void => {
  instance = null
  pending = null
}
