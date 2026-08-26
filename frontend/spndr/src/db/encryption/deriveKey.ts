/**
 * App-layer AES-GCM field encryption for the browser's local SQLite store, keyed by a
 * PIN/passphrase-derived key (PBKDF2-SHA256). `TauriSqlDriver` doesn't use this - SQLCipher
 * already encrypts the whole file at the page level there - so this only backs the browser
 * PWA path (`SqliteWasmDriver`, `MemorySqliteDriver`), where no page-level encrypted SQLite
 * build is in use.
 *
 * The primitives below are consumed from the SQLite worker only (see
 * `../worker/sqliteWorker.ts`'s `setEncryptionKey`/`encryptValue`/`decryptValue` handlers) so
 * the raw `CryptoKey` never crosses into the main thread - "key held only in worker memory" is
 * enforced by which module ever calls `deriveKey`, not by anything in this file itself.
 */

const PBKDF2_ITERATIONS = 210_000

export interface EncryptedField {
  iv: Uint8Array
  ciphertext: Uint8Array
}

export const deriveKey = async (passphrase: string, salt: Uint8Array): Promise<CryptoKey> => {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ])

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export const encryptField = async (key: CryptoKey, plaintext: string): Promise<EncryptedField> => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  return { iv, ciphertext: new Uint8Array(ciphertext) }
}

export const decryptField = async (key: CryptoKey, field: EncryptedField): Promise<string> => {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: field.iv as BufferSource },
    key,
    field.ciphertext as BufferSource
  )
  return new TextDecoder().decode(plaintext)
}
