-- Sprint 13.4: initial local schema.
--
-- Every syncable entity table mirrors one collection from the `/sync`
-- endpoints (backend/services/syncService.ts SYNC_ENTITIES) and carries the
-- same five metadata columns:
--   updatedAt          server-assigned last-write timestamp (ISO 8601)
--   deletedAt          soft-delete tombstone timestamp, null while alive
--   _localUpdatedAt     when this row last changed on THIS device
--   _dirty              1 while an unsynced local write is outstanding
--   _syncState          'synced' | 'pending' | 'conflict'
--
-- Full documents are kept as-received in `data` (JSON) rather than fanned out
-- into one SQL column per server field, so this schema doesn't have to be
-- re-migrated every time a Mongoose model gains a field; a handful of fields
-- per table are promoted to real columns purely because the local domain
-- engine (Sprint 13.5) and outbox (13.6) need to filter/sort/join on them.

-- ---------------------------------------------------------------------------
-- Engine tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS _outbox (
  opId TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload TEXT NOT NULL,
  baseUpdatedAt TEXT,
  createdAt TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lastError TEXT,
  nextAttemptAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_created ON _outbox (createdAt);

CREATE TABLE IF NOT EXISTS _sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS _conflicts (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  recordId TEXT NOT NULL,
  localData TEXT NOT NULL,
  serverData TEXT NOT NULL,
  detectedAt TEXT NOT NULL,
  resolvedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_conflicts_unresolved ON _conflicts (resolvedAt);

CREATE TABLE IF NOT EXISTS _blobs (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  recordId TEXT NOT NULL,
  mimeType TEXT,
  sizeBytes INTEGER NOT NULL DEFAULT 0,
  data BLOB,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blobs_record ON _blobs (entity, recordId);

-- ---------------------------------------------------------------------------
-- Syncable entity tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS accounts (
  _id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  workspaceId TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  currency TEXT NOT NULL,
  currentBalance REAL NOT NULL DEFAULT 0,
  isArchived INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT,
  _localUpdatedAt TEXT NOT NULL,
  _dirty INTEGER NOT NULL DEFAULT 0,
  _syncState TEXT NOT NULL DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_accounts_user_updated ON accounts (userId, updatedAt, _id);
CREATE INDEX IF NOT EXISTS idx_accounts_workspace_updated ON accounts (workspaceId, updatedAt, _id);

CREATE TABLE IF NOT EXISTS transactions (
  _id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  workspaceId TEXT,
  accountId TEXT NOT NULL,
  categoryId TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted',
  amount INTEGER NOT NULL,
  date TEXT NOT NULL,
  clearedStatus TEXT NOT NULL DEFAULT 'pending',
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT,
  _localUpdatedAt TEXT NOT NULL,
  _dirty INTEGER NOT NULL DEFAULT 0,
  _syncState TEXT NOT NULL DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_transactions_user_updated ON transactions (userId, updatedAt, _id);
CREATE INDEX IF NOT EXISTS idx_transactions_workspace_updated ON transactions (workspaceId, updatedAt, _id);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions (accountId);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions (categoryId);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date);

CREATE TABLE IF NOT EXISTS categories (
  _id TEXT PRIMARY KEY,
  userId TEXT,
  masterCategoryId TEXT,
  name TEXT NOT NULL,
  isArchived INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT,
  _localUpdatedAt TEXT NOT NULL,
  _dirty INTEGER NOT NULL DEFAULT 0,
  _syncState TEXT NOT NULL DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_categories_user_updated ON categories (userId, updatedAt, _id);
CREATE INDEX IF NOT EXISTS idx_categories_master ON categories (masterCategoryId);

CREATE TABLE IF NOT EXISTS budgets (
  _id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  workspaceId TEXT,
  categoryId TEXT,
  periodStart TEXT NOT NULL,
  periodEnd TEXT NOT NULL,
  isArchived INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT,
  _localUpdatedAt TEXT NOT NULL,
  _dirty INTEGER NOT NULL DEFAULT 0,
  _syncState TEXT NOT NULL DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_budgets_user_updated ON budgets (userId, updatedAt, _id);
CREATE INDEX IF NOT EXISTS idx_budgets_workspace_updated ON budgets (workspaceId, updatedAt, _id);
CREATE INDEX IF NOT EXISTS idx_budgets_category ON budgets (categoryId);

CREATE TABLE IF NOT EXISTS savingsGoals (
  _id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  workspaceId TEXT,
  accountId TEXT,
  status TEXT,
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT,
  _localUpdatedAt TEXT NOT NULL,
  _dirty INTEGER NOT NULL DEFAULT 0,
  _syncState TEXT NOT NULL DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_savingsGoals_user_updated ON savingsGoals (userId, updatedAt, _id);
CREATE INDEX IF NOT EXISTS idx_savingsGoals_workspace_updated ON savingsGoals (workspaceId, updatedAt, _id);

CREATE TABLE IF NOT EXISTS tags (
  _id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT,
  _localUpdatedAt TEXT NOT NULL,
  _dirty INTEGER NOT NULL DEFAULT 0,
  _syncState TEXT NOT NULL DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_tags_user_updated ON tags (userId, updatedAt, _id);

CREATE TABLE IF NOT EXISTS recurringRules (
  _id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  workspaceId TEXT,
  accountId TEXT NOT NULL,
  categoryId TEXT NOT NULL,
  nextDueDate TEXT NOT NULL,
  isActive INTEGER NOT NULL DEFAULT 1,
  isArchived INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT,
  _localUpdatedAt TEXT NOT NULL,
  _dirty INTEGER NOT NULL DEFAULT 0,
  _syncState TEXT NOT NULL DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_recurringRules_user_updated ON recurringRules (userId, updatedAt, _id);
CREATE INDEX IF NOT EXISTS idx_recurringRules_workspace_updated ON recurringRules (workspaceId, updatedAt, _id);
CREATE INDEX IF NOT EXISTS idx_recurringRules_account ON recurringRules (accountId);
CREATE INDEX IF NOT EXISTS idx_recurringRules_nextDueDate ON recurringRules (nextDueDate);
