import type { LocalDb } from './LocalDb'
import { setLocalDb } from './localDbInstance'
import { runMigrations } from './migrations/runMigrations'
import { MIGRATIONS } from './migrations/schema'
import { markLocalDbDamaged } from './localDbHealth'
import { isLocalFirstEnabled } from '../utils/localFirstFlag'
import { isLocalPinEnabled } from '../utils/localPinFlag'
import { isTauriRuntime } from '../desktop/isTauri'
import { migrateLegacyPinKeys, purgeLocalPinKeys } from '../offline/pinStorage'

const LOCAL_DB_FILENAME = 'corvale.sqlite3'

const openDriver = async (): Promise<LocalDb> => {
  if (isTauriRuntime()) {
    const { TauriSqlDriver } = await import('./TauriSqlDriver')
    return TauriSqlDriver.create(LOCAL_DB_FILENAME)
  }
  const { SqliteWasmDriver } = await import('./SqliteWasmDriver')
  return SqliteWasmDriver.create(LOCAL_DB_FILENAME)
}

/**
 * Opens the real driver, runs schema migrations, then issues a trivial read against a table every
 * migration creates. The probe matters: a half-encrypted file (the state a mistimed `PRAGMA key`
 * could leave behind under BUG-31, or ordinary on-disk corruption) can open and even migrate while
 * its data pages are unreadable ciphertext - the failure only surfaces on the first real `SELECT`,
 * which is exactly where the old bare "Failed to load local data" came from. Doing it here lets
 * `bootstrapLocalDb` classify the store as damaged before the app renders.
 */
const createMigratedDriver = async (): Promise<LocalDb> => {
  const db = await openDriver()
  await runMigrations(db, MIGRATIONS)
  await db.select('SELECT count(*) FROM _sync_meta')
  return db
}

/** Deletes the on-disk local store (+ its WAL/SHM sidecars) so a fresh one can be created. */
const destroyLocalStoreFile = async (): Promise<void> => {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core')
    try {
      await invoke('db_close')
    } catch {
      // Not open (or already closed) - nothing to detach before the unlink.
    }
    await invoke('db_reset_file', { filename: LOCAL_DB_FILENAME })
    return
  }
  const { SqliteWasmDriver } = await import('./SqliteWasmDriver')
  await SqliteWasmDriver.deleteStore(LOCAL_DB_FILENAME)
}

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
 * BUG-30: an open/migrate/probe failure is no longer swallowed into a silent in-memory fallback.
 * It marks the store damaged (`localDbHealth.ts`), and `LocalDbRecoveryGate` blocks the dashboard
 * behind an explicit "rebuild from your account" flow instead of every page erroring opaquely.
 */
export const bootstrapLocalDb = async (): Promise<void> => {
  if (!isLocalFirstEnabled()) {
    // Local-first is off for this build (the web build). Clear any PIN material a previous
    // flag-on build left on this device - PinGate/PinSettings are unmounted here, so an orphaned
    // salt/verifier would otherwise be permanent and unreachable. Recognises the pre-rename
    // `spndr_pin_*` names too (V6). Nothing else in this function needs to run when the flag is
    // off, migrateLegacyPinKeys() included - the keys it would copy forward are the ones we're
    // purging.
    purgeLocalPinKeys()
    return
  }

  if (!isLocalPinEnabled()) {
    // BUG-31: the local-lock PIN feature is dormant (no shipped build sets `VITE_LOCAL_PIN`) - the
    // desktop `db_set_key` corrupts an already-populated plaintext SQLite file, so v1.0.2/v1.0.3
    // desktop users who set a PIN are left with an unreadable store *and* an orphaned verifier in
    // `localStorage` that no UI can clear (PinGate/PinSettings are both gated off now). Purge it,
    // same as the local-first-off (web) path does. Recognises the pre-rename `spndr_pin_*` names.
    // SEC-40: encryption at rest no longer depends on this - the desktop SQLCipher key is a
    // device-local random key from the OS keychain, applied at `db_open`. The PIN, if it is ever
    // re-enabled, would be a separate screen lock, not the encryption key.
    purgeLocalPinKeys()
  } else {
    // V7.3e: copy any pre-rename `spndr_pin_*` keys forward before anything reads
    // `hasPinConfigured`, so a PIN set up before the Corvale rename still unlocks the local DB.
    migrateLegacyPinKeys()
  }

  try {
    const db = await createMigratedDriver()
    setLocalDb(db)
  } catch (error) {
    console.error('Local database failed to open or migrate; entering recovery mode', error)
    markLocalDbDamaged(error instanceof Error ? error.message : String(error))
  }
}

/**
 * BUG-30 recovery step: destroy the unreadable local store, recreate it empty, and install the
 * fresh driver. The caller (`LocalDbRecoveryGate`) then re-seeds it from `/sync/bootstrap` and
 * flips health back to healthy. Throws if the store still can't be created afterwards (e.g. a
 * failing disk), leaving health `damaged` so the gate can show a retry.
 */
export const rebuildLocalDb = async (): Promise<void> => {
  await destroyLocalStoreFile()
  const db = await createMigratedDriver()
  setLocalDb(db)
}

/**
 * SEC-40 recovery step: re-attempt the open without touching the store on disk. Used when the
 * failure was transient — the desktop SQLCipher key lives in the OS credential store, and a
 * locked login keyring (or a keychain-access prompt the user dismissed) makes `db_open` fail with
 * a `KEYCHAIN_UNAVAILABLE` tag until it is unlocked. Destroying the store there would throw away
 * unsynced offline changes over a problem a retry fixes.
 */
export const retryLocalDbOpen = async (): Promise<void> => {
  const db = await createMigratedDriver()
  setLocalDb(db)
}
