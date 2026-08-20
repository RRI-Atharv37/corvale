import type { Migration } from './runMigrations'
import initSql from './sql/0001_init.sql?raw'
import localDomainEntitiesSql from './sql/0002_local_domain_entities.sql?raw'
import transactionTemplatesSql from './sql/0003_transaction_templates.sql?raw'

/**
 * The app's real, versioned schema history. Each entry's `up` runs the
 * matching `.sql` file (loaded as raw text via Vite's `?raw` import) inside
 * the single transaction `runMigrations` wraps around it. Add new versions by
 * appending a new `.sql` file + migration entry here - never edit a
 * previously-shipped version in place, since devices may already be at it.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: async (tx) => {
      await tx.exec(initSql)
    },
  },
  {
    version: 2,
    up: async (tx) => {
      await tx.exec(localDomainEntitiesSql)
    },
  },
  {
    version: 3,
    up: async (tx) => {
      await tx.exec(transactionTemplatesSql)
    },
  },
]
