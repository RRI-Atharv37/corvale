import { invoke } from '@tauri-apps/api/core'
import type { LocalDb, LocalDbRow } from './LocalDb'

/**
 * Native `LocalDb` implementation for the Tauri desktop shell (Sprint 13.11). Every operation is a
 * thin `invoke()` call into Rust commands (`src-tauri/src/db.rs`) backed by `rusqlite` with the
 * `bundled-sqlcipher-vendored-openssl` feature - real page-level SQLCipher encryption, unlike the
 * browser's app-layer AES-GCM field fallback (see `db/encryption/deriveKey.ts`'s header comment,
 * which named this exact swap as the Sprint 13.11 follow-up to the 13.4 encryption spike).
 *
 * Shape mirrors `SqliteWasmDriver` deliberately: a thin RPC client with BEGIN/COMMIT/ROLLBACK driven
 * manually around the awaited transaction callback, so it's a drop-in swap behind `LocalDb` - see
 * `db/bootstrapLocalDb.ts`, which picks this driver specifically when `desktop/isTauri.ts` reports
 * the app is running inside the Tauri shell.
 */
export class TauriSqlDriver implements LocalDb {
  private constructor() {}

  static async create(filename = 'corvale.sqlite3'): Promise<TauriSqlDriver> {
    await invoke('db_open', { filename })
    return new TauriSqlDriver()
  }

  async exec(sql: string, params: unknown[] = []): Promise<void> {
    await invoke('db_exec', { sql, params })
  }

  async select<T extends LocalDbRow = LocalDbRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    return invoke<T[]>('db_select', { sql, params })
  }

  async transaction<T>(fn: (tx: LocalDb) => Promise<T>): Promise<T> {
    await this.exec('BEGIN')
    try {
      const result = await fn(this)
      await this.exec('COMMIT')
      return result
    } catch (error) {
      await this.exec('ROLLBACK')
      throw error
    }
  }

  /** Derives the SQLCipher page key from the PIN entirely inside Rust (`db_set_key` in
   * `src-tauri/src/db.rs`) - the passphrase and derived key never surface in this class's own
   * state. Same signature as `SqliteWasmDriver.setEncryptionKey`, which `offline/pinStorage.ts`
   * duck-types against via its `EncryptionCapableDb` check. */
  async setEncryptionKey(passphrase: string, salt: Uint8Array): Promise<void> {
    await invoke('db_set_key', { passphrase, salt: Array.from(salt) })
  }

  async close(): Promise<void> {
    await invoke('db_close')
  }
}
