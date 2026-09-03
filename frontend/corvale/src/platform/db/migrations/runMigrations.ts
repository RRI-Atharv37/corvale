import type { LocalDb } from '../LocalDb'

export interface Migration {
  version: number
  up: (tx: LocalDb) => Promise<void>
}

export interface MigrationResult {
  fromVersion: number
  toVersion: number
}

const ensureVersionTable = async (db: LocalDb): Promise<void> => {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS _schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)'
  )
  await db.exec('INSERT OR IGNORE INTO _schema_version (id, version) VALUES (1, 0)')
}

const getCurrentVersion = async (db: LocalDb): Promise<number> => {
  const rows = await db.select<{ version: number }>('SELECT version FROM _schema_version WHERE id = 1')
  return rows[0]?.version ?? 0
}

/**
 * Applies every migration whose version is greater than the database's current
 * schema version, in ascending order, one migration per SQLite transaction so a
 * failure partway through a migration can't leave the version marker ahead of
 * the schema it actually describes. Re-running an already-applied set is a no-op.
 */
export const runMigrations = async (db: LocalDb, migrations: Migration[]): Promise<MigrationResult> => {
  await ensureVersionTable(db)
  const fromVersion = await getCurrentVersion(db)

  const pending = migrations.filter((migration) => migration.version > fromVersion).sort((a, b) => a.version - b.version)

  let toVersion = fromVersion
  for (const migration of pending) {
    await db.transaction(async (tx) => {
      await migration.up(tx)
      await tx.exec('UPDATE _schema_version SET version = ? WHERE id = 1', [migration.version])
    })
    toVersion = migration.version
  }

  return { fromVersion, toVersion }
}
