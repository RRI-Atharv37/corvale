import { deriveKey } from '../db/encryption/deriveKey'
import { getLocalDb } from '../db/localDbInstance'

/**
 * PIN-gated local unlock (S9/SEC-02, S10/SEC-03). The PIN itself is never stored - only a
 * verifier derived through the same expensive PBKDF2 primitive used for the local-DB
 * encryption key (`deriveKey`, 210k iterations), so brute-forcing the verifier costs as much
 * as brute-forcing the key itself. On a correct PIN, the PIN + salt are handed to the driver to
 * derive the AES-GCM key that encrypts local fields (`db/encryption/deriveKey.ts`), so entering
 * the PIN is also what unlocks the data, not just the UI - and "unlocked" is defined as the
 * driver actually holding that key (`isLocalDbUnlocked`), not a storage flag.
 */

const PIN_SALT_KEY = 'corvale_pin_salt'
const PIN_VERIFIER_KEY = 'corvale_pin_verifier'
const PIN_ATTEMPTS_KEY = 'corvale_pin_attempts'

// V7.3e rename-compat: pre-rename builds wrote these under `spndr_pin_*`. `migrateLegacyPinKeys`
// copies them forward once, so a PIN set up before the Corvale rename keeps working without the
// user re-entering it. Unlike the KDF context literals below, these are only key *names* — no
// cryptographic material — so renaming them is safe as long as the copy-forward runs first.
const LEGACY_PIN_SALT_KEY = 'spndr_pin_salt'
const LEGACY_PIN_VERIFIER_KEY = 'spndr_pin_verifier'
const LEGACY_PIN_ATTEMPTS_KEY = 'spndr_pin_attempts'

export const MIN_PIN_LENGTH = 4
const MAX_ATTEMPTS = 5

/** Fires whenever the local encryption key is cleared while a PIN is configured, so a mounted `PinGate` can re-lock without a full reload. */
export const LOCAL_DB_LOCKED_EVENT = 'corvale:local-db-locked'

/**
 * One-time, idempotent copy-forward of the pre-rename `spndr_pin_*` localStorage keys to their
 * `corvale_pin_*` names (V7.3e). Runs at boot (`db/bootstrapLocalDb.ts`) before anything reads
 * `hasPinConfigured`. A bare rename would strand every existing PIN — the encrypted local DB
 * would look PIN-less rather than merely renamed. Never overwrites a value already present under
 * the new name; a no-op on a fresh install. See ROADMAP's V7 compat matrix.
 */
export const migrateLegacyPinKeys = (): void => {
    const renames: [legacyKey: string, currentKey: string][] = [
        [LEGACY_PIN_SALT_KEY, PIN_SALT_KEY],
        [LEGACY_PIN_VERIFIER_KEY, PIN_VERIFIER_KEY],
        [LEGACY_PIN_ATTEMPTS_KEY, PIN_ATTEMPTS_KEY],
    ]
    for (const [legacyKey, currentKey] of renames) {
        const legacyValue = localStorage.getItem(legacyKey)
        if (legacyValue === null) continue
        if (localStorage.getItem(currentKey) === null) {
            localStorage.setItem(currentKey, legacyValue)
        }
        localStorage.removeItem(legacyKey)
    }
}

/**
 * Removes every PIN-related `localStorage` key, under **both** the current `corvale_pin_*` names
 * and the pre-rename `spndr_pin_*` ones. Called from `bootstrapLocalDb` on a build where
 * local-first is disabled (the web build - `VITE_LOCAL_FIRST=false`).
 *
 * Why it's needed (V6): a device that once ran a flag-on build and set a PIN, then loads a
 * flag-off build, keeps an orphaned salt/verifier/attempts trio in `localStorage` pointing at an
 * encrypted local DB that's now unreachable. `PinGate` and `PinSettings` are both unmounted when
 * the flag is off, so nothing in the UI can ever clear it. The affected population is exactly the
 * pre-rename devices, which is why both name sets are purged, not just the current one.
 *
 * Idempotent; a no-op on a device that never set a PIN.
 */
export const purgeLocalPinKeys = (): void => {
    const keys = [
        PIN_SALT_KEY,
        PIN_VERIFIER_KEY,
        PIN_ATTEMPTS_KEY,
        LEGACY_PIN_SALT_KEY,
        LEGACY_PIN_VERIFIER_KEY,
        LEGACY_PIN_ATTEMPTS_KEY,
    ]
    for (const key of keys) {
        localStorage.removeItem(key)
    }
}

// Two separate duck-type surfaces, deliberately not merged into one. `TauriSqlDriver` only
// implements `setEncryptionKey` (the passphrase never leaves Rust - SQLCipher itself is the
// gate, per `EncryptionCapableDb.ts`'s comment), so requiring `hasEncryptionKey`/
// `clearEncryptionKey` here would silently stop applying the real key on desktop.
interface PinKeySetter {
    setEncryptionKey: (passphrase: string, salt: Uint8Array) => Promise<void>
}

const hasKeySetter = (db: unknown): db is PinKeySetter =>
    typeof db === 'object' && db !== null && typeof (db as Partial<PinKeySetter>).setEncryptionKey === 'function'

interface PinKeyState {
    hasEncryptionKey: () => boolean
    clearEncryptionKey: () => void
}

const hasKeyState = (db: unknown): db is PinKeyState =>
    typeof db === 'object' &&
    db !== null &&
    typeof (db as Partial<PinKeyState>).hasEncryptionKey === 'function' &&
    typeof (db as Partial<PinKeyState>).clearEncryptionKey === 'function'

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes))
const fromBase64 = (value: string): Uint8Array => Uint8Array.from(atob(value), (char) => char.charCodeAt(0))

/** Byte-for-byte comparison that never short-circuits, so a mismatch position can't leak via timing. */
const constantTimeEqual = (a: string, b: string): boolean => {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i += 1) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return diff === 0
}

// The verifier is computed by deriving a *separate* key from a salt derived from the stored
// salt (domain-separated, via SHA-256 with a fixed context string) and using that key to
// AES-GCM-encrypt a fixed plaintext with a fixed IV. The result is deterministic for a given
// PIN + salt, costs the full 210k-iteration PBKDF2 stretch (via `deriveKey`), and never shares
// key material with the actual data-encryption key applied to the local DB.
// FREEZE — DO NOT RENAME these two literals (V7.3e / V-R7). They are PBKDF2 domain-separation
// inputs baked into every local DB set up against them, not brand strings. Changing either
// spelling changes the derived verifier key and makes every pre-rename encrypted local DB
// permanently unrecoverable, for zero user-visible benefit. `pinHardening.test.ts` asserts the
// exact source text so a blind "finish the rename" sweep trips a red test instead of shipping
// data loss. See ROADMAP's V7 compat matrix.
const VERIFIER_SALT_CONTEXT = new TextEncoder().encode('spndr-pin-verifier-salt-v1')
const VERIFIER_PLAINTEXT = new TextEncoder().encode('spndr-pin-verifier-v1')
const VERIFIER_IV = new Uint8Array(12)

const deriveVerifierSalt = async (salt: Uint8Array): Promise<Uint8Array> => {
    const combined = new Uint8Array(salt.length + VERIFIER_SALT_CONTEXT.length)
    combined.set(salt, 0)
    combined.set(VERIFIER_SALT_CONTEXT, salt.length)
    const digest = await crypto.subtle.digest('SHA-256', combined)
    return new Uint8Array(digest)
}

const computeVerifier = async (pin: string, salt: Uint8Array): Promise<string> => {
    const verifierSalt = await deriveVerifierSalt(salt)
    const verifierKey = await deriveKey(pin, verifierSalt)
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: VERIFIER_IV as BufferSource }, verifierKey, VERIFIER_PLAINTEXT)
    return toBase64(new Uint8Array(ciphertext))
}

const getAttempts = (): number => {
    const raw = localStorage.getItem(PIN_ATTEMPTS_KEY)
    const parsed = raw ? parseInt(raw, 10) : 0
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const incrementAttempts = (): void => {
    localStorage.setItem(PIN_ATTEMPTS_KEY, String(getAttempts() + 1))
}

const resetAttempts = (): void => {
    localStorage.removeItem(PIN_ATTEMPTS_KEY)
}

const applyEncryptionKey = async (pin: string, salt: Uint8Array): Promise<void> => {
    let db: unknown
    try {
        db = await getLocalDb()
    } catch {
        // The local DB itself is unavailable (e.g. local-first disabled in this build) - the PIN
        // still gates the UI. This is the only failure that's safe to swallow.
        return
    }
    if (!hasKeySetter(db)) return
    // BUG-31: do NOT swallow a failure from setEncryptionKey. A swallowed error left a stored PIN
    // verifier pointing at a local DB the key was never applied to - a dead PIN. Callers roll back.
    await db.setEncryptionKey(pin, salt)
}

export const hasPinConfigured = (): boolean => localStorage.getItem(PIN_VERIFIER_KEY) !== null

export const setupPin = async (pin: string): Promise<void> => {
    if (pin.length < MIN_PIN_LENGTH) {
        throw new Error(`PIN must be at least ${MIN_PIN_LENGTH} digits`)
    }

    const salt = crypto.getRandomValues(new Uint8Array(16))
    const verifier = await computeVerifier(pin, salt)
    localStorage.setItem(PIN_SALT_KEY, toBase64(salt))
    localStorage.setItem(PIN_VERIFIER_KEY, verifier)
    resetAttempts()
    try {
        await applyEncryptionKey(pin, salt)
    } catch (error) {
        // BUG-31: the key couldn't be applied to the local DB - don't leave a verifier pointing
        // at a store this PIN doesn't actually unlock. Surface the failure to the caller.
        clearPin()
        throw error
    }
}

export const verifyStoredPin = async (pin: string): Promise<boolean> => {
    if (getAttempts() >= MAX_ATTEMPTS) {
        throw new Error('Too many attempts. Locked out - use "Forgot PIN?" to reset and resync.')
    }

    const saltB64 = localStorage.getItem(PIN_SALT_KEY)
    const verifier = localStorage.getItem(PIN_VERIFIER_KEY)
    if (!saltB64 || !verifier) return false

    const salt = fromBase64(saltB64)
    const candidate = await computeVerifier(pin, salt)
    const matches = constantTimeEqual(candidate, verifier)

    if (matches) {
        resetAttempts()
        await applyEncryptionKey(pin, salt)
    } else {
        incrementAttempts()
    }
    return matches
}

export const clearPin = (): void => {
    localStorage.removeItem(PIN_SALT_KEY)
    localStorage.removeItem(PIN_VERIFIER_KEY)
    resetAttempts()
}

/**
 * True when the local DB is actually readable right now: either it holds the derived
 * encryption key, or its driver has no encryption surface at all (no PIN feature in this
 * build/environment). False whenever a PIN is configured but the key hasn't - yet, or any
 * more - been applied this session. This is the sole signal `PinGate` gates rendering on.
 */
export const isLocalDbUnlocked = async (): Promise<boolean> => {
    try {
        const db = await getLocalDb()
        if (hasKeyState(db)) {
            return db.hasEncryptionKey()
        }
        return true
    } catch {
        return true
    }
}

/** Clears the derived key from wherever it's held (worker memory / SQLCipher handle). Does not touch the PIN itself - a subsequent correct guess still works. */
export const clearLocalEncryptionKey = async (): Promise<void> => {
    try {
        const db = await getLocalDb()
        if (hasKeyState(db)) {
            db.clearEncryptionKey()
        }
    } catch {
        // Local DB unavailable - nothing to clear.
    }
}

/** Clears the key and notifies any mounted `PinGate` to re-lock immediately. Wire this to an explicit "Lock now" action, a hide-timeout, or logout. */
export const lockLocalDb = async (): Promise<void> => {
    await clearLocalEncryptionKey()
    window.dispatchEvent(new Event(LOCAL_DB_LOCKED_EVENT))
}
