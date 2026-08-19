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
  | 'categorizationRules'
  | 'savingsGoalContributions'

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
 * Columns promoted out of `data` per table (see `sql/0001_init.sql` and
 * `sql/0002_local_domain_entities.sql`), by the same field name the server
 * document uses. Several of these are `NOT NULL` with no default (e.g.
 * `accounts.userId`), so `upsertFromServer` must populate them explicitly —
 * inserting only the metadata columns fails the very first real seed.
 */
const PROMOTED_COLUMNS: Record<SyncableTableName, readonly string[]> = {
  accounts: ['userId', 'workspaceId', 'name', 'type', 'currency', 'currentBalance', 'isArchived'],
  transactions: [
    'userId',
    'workspaceId',
    'accountId',
    'categoryId',
    'type',
    'status',
    'amount',
    'date',
    'clearedStatus',
  ],
  categories: ['userId', 'masterCategoryId', 'name', 'isArchived'],
  budgets: ['userId', 'workspaceId', 'categoryId', 'periodStart', 'periodEnd', 'isArchived'],
  savingsGoals: ['userId', 'workspaceId', 'accountId', 'status'],
  tags: ['userId', 'name'],
  recurringRules: ['userId', 'workspaceId', 'accountId', 'categoryId', 'nextDueDate', 'isActive', 'isArchived'],
  categorizationRules: ['userId', 'categoryId', 'accountId', 'priority', 'isActive'],
  savingsGoalContributions: ['userId', 'goalId', 'amount', 'contributedAt'],
}

/** Mirrors the Mongoose schema defaults for promoted fields that are optional on the wire but NOT NULL locally. */
const PROMOTED_COLUMN_DEFAULTS: Readonly<Record<string, unknown>> = {
  currentBalance: 0,
  isArchived: false,
  status: 'posted',
  clearedStatus: 'pending',
  isActive: true,
  priority: 0,
}

/** SQLite has no boolean type; promoted boolean fields (isArchived, isActive) store as 0/1. */
const toSqlValue = (column: string, value: unknown): unknown => {
  const resolved = value === undefined ? PROMOTED_COLUMN_DEFAULTS[column] : value
  if (typeof resolved === 'boolean') return resolved ? 1 : 0
  if (resolved === undefined) return null
  return resolved
}

/**
 * Every syncable table stores its rows as the full server document (JSON,
 * in `data`) plus the shared sync/query metadata columns, plus a handful of
 * promoted columns the local domain engine (Sprint 13.5) and outbox (13.6)
 * filter/sort/join on.
 */
export class Repository<T extends SyncableRecord> {
  constructor(private readonly table: SyncableTableName) {}

  /** Upserts server-shaped documents (as returned by bootstrap/pull) as already-synced rows. */
  async upsertFromServer(db: LocalDb, docs: T[]): Promise<void> {
    const localUpdatedAt = new Date().toISOString()
    const promoted = PROMOTED_COLUMNS[this.table] ?? []
    const columns = ['_id', 'data', 'updatedAt', 'deletedAt', '_localUpdatedAt', '_dirty', '_syncState', ...promoted]

    const updateClause = [
      'data = excluded.data',
      'updatedAt = excluded.updatedAt',
      'deletedAt = excluded.deletedAt',
      '_localUpdatedAt = excluded._localUpdatedAt',
      '_dirty = 0',
      "_syncState = 'synced'",
      ...promoted.map((column) => `${column} = excluded.${column}`),
    ].join(', ')

    for (const doc of docs) {
      const record = doc as unknown as Record<string, unknown>
      const values = [
        doc._id,
        JSON.stringify(doc),
        doc.updatedAt,
        doc.deletedAt ?? null,
        localUpdatedAt,
        0,
        'synced',
        ...promoted.map((column) => toSqlValue(column, record[column])),
      ]

      await db.exec(
        `INSERT INTO ${this.table} (${columns.join(', ')})
         VALUES (${columns.map(() => '?').join(', ')})
         ON CONFLICT(_id) DO UPDATE SET ${updateClause}`,
        values
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
