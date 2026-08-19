import type { LocalDb } from '../LocalDb'
import { tableInvalidationBus } from '../invalidation/tableInvalidationBus'
import { Repository, type SyncableRecord, type SyncableTableName } from './Repository'
import type { BootstrapSyncSnapshot } from '../../utils/syncApi'

type SeedableField = Exclude<keyof BootstrapSyncSnapshot, 'checkpoint'>

const REPOSITORIES: Record<SeedableField, Repository<SyncableRecord>> = {
  accounts: new Repository('accounts' as SyncableTableName),
  transactions: new Repository('transactions' as SyncableTableName),
  categories: new Repository('categories' as SyncableTableName),
  budgets: new Repository('budgets' as SyncableTableName),
  savingsGoals: new Repository('savingsGoals' as SyncableTableName),
  tags: new Repository('tags' as SyncableTableName),
  recurringRules: new Repository('recurringRules' as SyncableTableName),
  categorizationRules: new Repository('categorizationRules' as SyncableTableName),
  savingsGoalContributions: new Repository('savingsGoalContributions' as SyncableTableName),
}

/**
 * Seeds every local table from a `/sync/bootstrap` response inside a single
 * transaction, then persists its checkpoint so a subsequent `/sync/pull` can
 * resume from exactly where the bootstrap left off. Table invalidation is
 * published after commit so any mounted `useLocalQuery` hooks refetch.
 */
export const seedFromBootstrap = async (db: LocalDb, snapshot: BootstrapSyncSnapshot): Promise<void> => {
  const fields = Object.keys(REPOSITORIES) as SeedableField[]

  await db.transaction(async (tx) => {
    for (const field of fields) {
      await REPOSITORIES[field].upsertFromServer(tx, snapshot[field])
    }
    await tx.exec(
      `INSERT INTO _sync_meta (key, value) VALUES ('checkpoint', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [snapshot.checkpoint]
    )
  })

  for (const field of fields) {
    tableInvalidationBus.publish(field)
  }
}
