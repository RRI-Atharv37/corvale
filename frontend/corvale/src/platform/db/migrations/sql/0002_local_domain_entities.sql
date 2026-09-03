-- Sprint 13.5: local domain engine.
--
-- Adds the two syncable entities the local domain engine needs that were
-- never added to the sync surface in 13.2/13.3: `categorizationRules`
-- (rule application/testing/bulk-apply) and `savingsGoalContributions`
-- (savings goal average-contribution projection). Both are personal-only
-- (no workspaceId), same metadata-column convention as 0001_init.sql.

CREATE TABLE IF NOT EXISTS categorizationRules (
  _id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  categoryId TEXT,
  accountId TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  isActive INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT,
  _localUpdatedAt TEXT NOT NULL,
  _dirty INTEGER NOT NULL DEFAULT 0,
  _syncState TEXT NOT NULL DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_categorizationRules_user_updated ON categorizationRules (userId, updatedAt, _id);
CREATE INDEX IF NOT EXISTS idx_categorizationRules_priority ON categorizationRules (userId, isActive, priority);

CREATE TABLE IF NOT EXISTS savingsGoalContributions (
  _id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  goalId TEXT NOT NULL,
  amount INTEGER NOT NULL,
  contributedAt TEXT NOT NULL,
  data TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT,
  _localUpdatedAt TEXT NOT NULL,
  _dirty INTEGER NOT NULL DEFAULT 0,
  _syncState TEXT NOT NULL DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_savingsGoalContributions_user_updated ON savingsGoalContributions (userId, updatedAt, _id);
CREATE INDEX IF NOT EXISTS idx_savingsGoalContributions_goal ON savingsGoalContributions (goalId, contributedAt);
