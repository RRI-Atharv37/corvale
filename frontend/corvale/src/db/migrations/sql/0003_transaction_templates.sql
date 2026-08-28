-- Sprint 13.9: quick-add transaction templates.
--
-- `transactionTemplates` was never added to the sync surface in 13.2/13.3/13.5
-- even though `backend/models/TransactionTemplate.ts` already has soft-delete
-- and a `{userId, updatedAt, _id}` index from 13.2 - it just wasn't registered
-- in `SYNC_ENTITIES` yet. Personal-only (no workspaceId), same metadata-column
-- convention as 0001_init.sql/0002_local_domain_entities.sql.

CREATE TABLE IF NOT EXISTS transactionTemplates (
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
CREATE INDEX IF NOT EXISTS idx_transactionTemplates_user_updated ON transactionTemplates (userId, updatedAt, _id);
