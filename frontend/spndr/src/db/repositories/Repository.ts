import type { LocalDb, LocalDbRow } from '../LocalDb'

/** The syncable entity tables created by migration 0001 (see `sql/0001_init.sql`). */
export type SyncableTableName =
  | 'accounts'
  | 'transactions'
  | 'categories'
  | 'budgets'
  | 'savingsGoals'
  | 'tags'
  | 'recurringRules'

export interface SyncableRecord {
  _id: string
  updatedAt: string
  deletedAt?: string | null
  [field: string]: unknown
}

interface SyncableRow extends LocalDbRow {
  data: string
}

/**
 * Skeleton repository: every syncable table stores its rows as the
 * full server document (JSON, in `data`) plus the shared sync/query metadata
 * columns from the schema. Sprint 13.5 (local domain engine) builds the
 * entity-specific read APIs on top of this; this sprint only needs enough to
 * seed and re-seed a table from the server and read rows back out.
 */
export class Repository<T extends SyncableRecord> {
  constructor(private readonly table: SyncableTableName) {}

  /** Upserts server-shaped documents (as returned by bootstrap/pull) as already-synced rows. */
  async upsertFromServer(db: LocalDb, docs: T[]): Promise<void> {
    const localUpdatedAt = new Date().toISOString()
    for (const doc of docs) {
      await db.exec(
        `INSERT INTO ${this.table} (_id, data, updatedAt, deletedAt, _localUpdatedAt, _dirty, _syncState)
         VALUES (?, ?, ?, ?, ?, 0, 'synced')
         ON CONFLICT(_id) DO UPDATE SET
           data = excluded.data,
           updatedAt = excluded.updatedAt,
           deletedAt = excluded.deletedAt,
           _localUpdatedAt = excluded._localUpdatedAt,
           _dirty = 0,
           _syncState = 'synced'`,
        [doc._id, JSON.stringify(doc), doc.updatedAt, doc.deletedAt ?? null, localUpdatedAt]
      )
    }
  }

  async findById(db: LocalDb, id: string): Promise<T | null> {
    const rows = await db.select<SyncableRow>(`SELECT data FROM ${this.table} WHERE _id = ? AND deletedAt IS NULL`, [
      id,
    ])
    return rows[0] ? (JSON.parse(rows[0].data) as T) : null
  }

  async list(db: LocalDb): Promise<T[]> {
    const rows = await db.select<SyncableRow>(
      `SELECT data FROM ${this.table} WHERE deletedAt IS NULL ORDER BY updatedAt DESC`
    )
    return rows.map((row) => JSON.parse(row.data) as T)
  }
}
