import { isLocalFirstEnabled } from './localFirstFlag'

/**
 * BUG-31: gates the local-lock PIN feature (PIN gate, setup prompt, and Settings panel). It is
 * dormant in every shipped build - no `.env` sets `VITE_LOCAL_PIN` - and stays that way until
 * encryption-at-rest is done properly.
 *
 * Why it's off: the desktop `db_set_key` command applies the SQLCipher page key with a bare
 * `PRAGMA key` against an already-open, already-populated *plaintext* database. SQLCipher needs
 * `PRAGMA rekey` (or an `sqlcipher_export` copy) to encrypt data in place; a bare `PRAGMA key`
 * after data exists leaves the file half-plaintext / half-ciphertext and permanently unreadable.
 * So setting a PIN on the desktop app destroyed the local store. The real fix is to key the DB
 * from the OS keychain at `db_open`, on a database encrypted from creation - not a user PIN
 * applied later - at which point this flag can default on.
 *
 * The PIN only ever makes sense alongside the local-first engine, so this requires both flags.
 */
export const isLocalPinEnabled = (): boolean =>
    isLocalFirstEnabled() && import.meta.env.VITE_LOCAL_PIN === 'true'
