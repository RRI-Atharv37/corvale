import { setLocalDb } from './localDbInstance'
import { runMigrations } from './migrations/runMigrations'
import { MIGRATIONS } from './migrations/schema'
import { isLocalFirstEnabled } from '../utils/localFirstFlag'
import { isTauriRuntime } from '../desktop/isTauri'
import { migrateLegacyPinKeys } from '../offline/pinStorage'

/**
 * Chooses and installs the real `LocalDb` implementation for this runtime before the app renders
 * (called once from `main.tsx`).
 *
 * Fixes a latent gap found while wiring in `TauriSqlDriver`: nothing in the app ever called
 * `setLocalDb`, so `getLocalDb()`'s lazy fallback (`localDbInstance.ts`) silently created an
 * ephemeral in-memory `MemorySqliteDriver` on every boot - correct for tests (its intended use),
 * but it meant the local-first engine never actually persisted anything between sessions in the
 * real app either, browser or desktop. This function is what makes `SqliteWasmDriver` (Sprint 13.4)
 * and `TauriSqlDriver` (Sprint 13.11) real rather than dead code.
 *
 * Driver creation errors (native module missing, OPFS unavailable, etc.) are swallowed so a broken
 * driver never blocks app boot - the app falls back to the lazy in-memory default, same as it
 * silently did before this function existed.
 */
export const bootstrapLocalDb = async (): Promise<void> => {
  // V7.3e: copy any pre-rename `spndr_pin_*` keys forward before anything reads `hasPinConfigured`,
  // so a PIN set up before the Corvale rename still unlocks the local DB. Idempotent no-op otherwise.
  migrateLegacyPinKeys()

  if (!isLocalFirstEnabled()) return

  try {
    if (isTauriRuntime()) {
      const { TauriSqlDriver } = await import('./TauriSqlDriver')
      const db = await TauriSqlDriver.create()
      await runMigrations(db, MIGRATIONS)
      setLocalDb(db)
      return
    }

    const { SqliteWasmDriver } = await import('./SqliteWasmDriver')
    const db = await SqliteWasmDriver.create()
    await runMigrations(db, MIGRATIONS)
    setLocalDb(db)
  } catch (error) {
    console.error('Failed to initialize the persistent local database; falling back to in-memory storage', error)
  }
}
