/**
 * Sprint 13.4 encryption decision (spike outcome):
 *
 * The preferred approach - a SQLite3MultipleCiphers WASM build giving
 * transparent page-level encryption - was evaluated and deferred. This repo
 * depends on the official `@sqlite.org/sqlite-wasm` build, and swapping to
 * the MultipleCiphers fork means owning a custom WASM build/upgrade pipeline,
 * which is a bigger lift than this sprint's scope. It's revisited for the
 * Tauri desktop shell (Sprint 13.11), where native SQLCipher is the intended
 * choice anyway and doesn't have this WASM-build constraint.
 *
 * For the browser PWA, the fallback is what actually ships: app-layer
 * AES-GCM field encryption, keyed by a PIN/passphrase-derived key
 * (PBKDF2-SHA256, per the locked architecture decision). The primitives
 * below are consumed from the SQLite worker only (see
 * `../worker/sqliteWorker.ts`'s `setEncryptionKey`/`encryptValue`/
 * `decryptValue` handlers) so the raw `CryptoKey` never crosses into the main
 * thread - "key held only in worker memory" is enforced by which module ever
 * calls `deriveKey`, not by anything in this file itself. Wiring which
 * columns get encrypted, and the PIN entry/unlock UI, land in Sprint 13.7.
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
