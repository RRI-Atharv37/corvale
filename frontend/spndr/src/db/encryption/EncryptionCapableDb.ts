/**
 * Duck-typed encryption surface a `LocalDb` driver may optionally implement (S8, SEC-01).
 * `MemorySqliteDriver` and `SqliteWasmDriver` implement this - the local store holds an
 * app-layer AES-GCM key (`db/encryption/deriveKey.ts`) and encrypts the `data` blob column.
 * `TauriSqlDriver` deliberately does not: SQLCipher already encrypts the whole file at the
 * page level, so app-layer field encryption there would be redundant cost for no benefit.
 * `Repository.ts` checks for this shape (`hasEncryptionKey`/`encryptText`/`decryptText`)
 * before touching a driver's `data` column, and falls back to plain JSON when it's absent.
 */
export interface EncryptionCapableDb {
  setEncryptionKey(passphrase: string, salt: Uint8Array): Promise<void>
  hasEncryptionKey(): boolean
  clearEncryptionKey(): void
  encryptText(plaintext: string): Promise<string>
  decryptText(serialized: string): Promise<string>
}
