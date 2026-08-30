import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import * as deriveKeyModule from '../../db/encryption/deriveKey'
import { resetLocalDbForTests, setLocalDb } from '../../db/localDbInstance'
import { clearPin, hasPinConfigured, migrateLegacyPinKeys, purgeLocalPinKeys, setupPin, verifyStoredPin } from '../pinStorage'

/**
 * Acceptance spec for PIN cost + lockout hardening (S9, SEC-02).
 *
 * `pinStorage.ts` today computes the stored verifier as a single-round `SHA-256(pin:salt)`
 * (`hashPin`) with no attempt counter, no lockout, and no minimum length. Because
 * `applyEncryptionKey` derives the local-DB AES key from the *same* PIN and salt via the
 * expensive 210k-iteration PBKDF2 (`db/encryption/deriveKey.ts`), a cheap verifier means
 * recovering the PIN through brute force against the verifier hands over the expensive key for
 * free - the PBKDF2 cost buys nothing.
 *
 * Contract assumed here:
 *   - The verifier is derived through the *same* expensive `deriveKey` primitive used for the
 *     data key (e.g. HKDF-splitting the PBKDF2 output into a key half and a verifier half), so a
 *     guess costs the full 210k iterations, not one SHA-256 call. This spec does not assert an
 *     exact construction - only that `deriveKey` is actually invoked by `setupPin`/
 *     `verifyStoredPin`, and that the stored verifier is no longer reproducible via the old
 *     cheap scheme.
 *   - `setupPin` enforces a minimum PIN length and rejects shorter ones without storing anything.
 *   - `verifyStoredPin` counts consecutive wrong guesses and locks out further attempts (including
 *     correct ones) once a threshold is hit, until the lockout is cleared. The counter resets on
 *     a correct unlock. `clearPin` (used by the forgot-PIN/wipe flow) also clears any lockout
 *     state, since a wiped device has no PIN to be locked out of.
 *   - `setupPin`/a successful `verifyStoredPin` still apply the derived key to the local DB via
 *     `db.setEncryptionKey`, exactly as today - SEC-02's fix must not regress SEC-01's fix.
 *
 * A minimal fake standing in for `SqliteWasmDriver`/`MemorySqliteDriver`'s encryption surface
 * (S8) is injected via the same `setLocalDb`/`resetLocalDbForTests` seam other local-store tests
 * already use, so this spec doesn't depend on S8 having landed first.
 */

const PIN_SALT_KEY = 'corvale_pin_salt'
const PIN_VERIFIER_KEY = 'corvale_pin_verifier'
const LEGACY_PIN_SALT_KEY = 'spndr_pin_salt'
const LEGACY_PIN_VERIFIER_KEY = 'spndr_pin_verifier'
const LEGACY_PIN_ATTEMPTS_KEY = 'spndr_pin_attempts'

const legacySha256Verifier = async (pin: string, saltB64: string): Promise<string> => {
    const data = new TextEncoder().encode(`${pin}:${saltB64}`)
    const digest = await crypto.subtle.digest('SHA-256', data)
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
}

class FakeEncryptableDb {
    key: { passphrase: string; salt: Uint8Array } | null = null

    async setEncryptionKey(passphrase: string, salt: Uint8Array): Promise<void> {
        this.key = { passphrase, salt }
    }

    hasEncryptionKey(): boolean {
        return this.key !== null
    }

    clearEncryptionKey(): void {
        this.key = null
    }

    // Unused `LocalDb` members - pinStorage never calls these directly.
    async exec(): Promise<void> {}
    async select(): Promise<never[]> {
        return []
    }
    async transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
        return fn(this)
    }
    async close(): Promise<void> {}
}

describe('PIN verifier hardening (S9, SEC-02)', () => {
    let fakeDb: FakeEncryptableDb

    beforeEach(() => {
        localStorage.clear()
        fakeDb = new FakeEncryptableDb()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setLocalDb(fakeDb as any)
    })

    afterEach(() => {
        resetLocalDbForTests()
        vi.restoreAllMocks()
    })

    it('derives the stored verifier via the expensive PBKDF2 primitive, not a bare SHA-256 digest', async () => {
        const deriveKeySpy = vi.spyOn(deriveKeyModule, 'deriveKey')

        await setupPin('284915')

        expect(deriveKeySpy).toHaveBeenCalled()
    })

    it('no longer matches the old single-round SHA-256(pin:salt) verifier scheme', async () => {
        await setupPin('284915')

        const saltB64 = localStorage.getItem(PIN_SALT_KEY)
        const storedVerifier = localStorage.getItem(PIN_VERIFIER_KEY)
        expect(saltB64).toBeTruthy()

        const legacyEquivalent = await legacySha256Verifier('284915', saltB64!)
        expect(storedVerifier).not.toBe(legacyEquivalent)
    })

    it('applies the derived key to the local DB on setup', async () => {
        await setupPin('284915')

        expect(fakeDb.hasEncryptionKey()).toBe(true)
    })

    it('re-applies the same encryption key on a correct unlock', async () => {
        await setupPin('284915')
        fakeDb.clearEncryptionKey()

        const ok = await verifyStoredPin('284915')

        expect(ok).toBe(true)
        expect(fakeDb.hasEncryptionKey()).toBe(true)
    })

    it('rejects a wrong PIN without applying an encryption key', async () => {
        await setupPin('284915')
        fakeDb.clearEncryptionKey()

        const ok = await verifyStoredPin('000000')

        expect(ok).toBe(false)
        expect(fakeDb.hasEncryptionKey()).toBe(false)
    })

    it('rejects a PIN shorter than the minimum length at setup, storing nothing', async () => {
        await expect(setupPin('12')).rejects.toThrow(/at least|minimum|short/i)

        expect(hasPinConfigured()).toBe(false)
    })

    it('locks out further attempts (including a correct one) after repeated wrong guesses', async () => {
        await setupPin('284915')

        for (let attempt = 0; attempt < 5; attempt += 1) {
            expect(await verifyStoredPin('000000')).toBe(false)
        }

        await expect(verifyStoredPin('284915')).rejects.toThrow(/locked|too many attempts/i)
    })

    it('resets the attempt counter after a correct unlock', async () => {
        await setupPin('284915')

        for (let attempt = 0; attempt < 4; attempt += 1) {
            expect(await verifyStoredPin('000000')).toBe(false)
        }
        expect(await verifyStoredPin('284915')).toBe(true)

        // The counter must have reset - four more wrong guesses (one short of the lockout
        // threshold) must not lock a subsequent correct guess out.
        for (let attempt = 0; attempt < 4; attempt += 1) {
            expect(await verifyStoredPin('111111')).toBe(false)
        }
        expect(await verifyStoredPin('284915')).toBe(true)
    })

    it('clearPin also clears any lockout / attempt-count state', async () => {
        await setupPin('284915')
        for (let attempt = 0; attempt < 5; attempt += 1) {
            await verifyStoredPin('000000')
        }

        clearPin()
        await setupPin('551133')

        expect(await verifyStoredPin('551133')).toBe(true)
    })
})

/**
 * BUG-31: `applyEncryptionKey` used to swallow *every* failure from `db.setEncryptionKey`,
 * including a real one (the desktop `db_set_key` corrupting an already-populated plaintext DB).
 * That left a stored verifier pointing at a local DB the key was never applied to - a dead PIN.
 * `setupPin` must now surface the failure and leave nothing behind, so the UI can report it.
 */
describe('setupPin surfaces a failed key application and rolls back (BUG-31)', () => {
    afterEach(() => {
        resetLocalDbForTests()
        localStorage.clear()
    })

    it('rejects and stores no verifier when setEncryptionKey throws', async () => {
        class ThrowingDb {
            async setEncryptionKey(): Promise<void> {
                throw new Error('SQLCipher: file is not a database')
            }
            hasEncryptionKey(): boolean {
                return false
            }
            clearEncryptionKey(): void {}
            async exec(): Promise<void> {}
            async select(): Promise<never[]> {
                return []
            }
            async transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
                return fn(this)
            }
            async close(): Promise<void> {}
        }
        localStorage.clear()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setLocalDb(new ThrowingDb() as any)

        await expect(setupPin('284915')).rejects.toThrow(/not a database/i)

        expect(hasPinConfigured()).toBe(false)
        expect(localStorage.getItem(PIN_SALT_KEY)).toBeNull()
    })
})

/**
 * V7.3e rename-compat shim (FREEZE - do not rename): `VERIFIER_SALT_CONTEXT` and
 * `VERIFIER_PLAINTEXT` are PBKDF2 domain-separation inputs, not brand strings - they feed the
 * verifier derivation (`deriveVerifierSalt`/`computeVerifier`) that every existing encrypted
 * local DB was set up against. Renaming either literal changes the derived key and makes every
 * pre-rename local DB permanently unrecoverable, in exchange for nothing any user can see. This
 * guard exists so a future "finish the rename" pass trips a red test instead of shipping data
 * loss (ROADMAP's V7 compat matrix, V-R7).
 */
describe('PIN verifier KDF context is frozen (V7.3e rename shim - never rename)', () => {
    it('pinStorage.ts still derives the verifier from the exact frozen context/plaintext literals', () => {
        // Source-text guard, matching pwa/__tests__/pwaConfig.test.ts's drift-guard style: these
        // two literals are PBKDF2 domain-separation inputs baked into every existing encrypted
        // local DB, not brand strings. A behavioral known-answer test would only catch this after
        // the fact (once a DB is already unrecoverable in some other test's fixture); reading the
        // source directly fails the instant either literal is touched, blind `sed` included.
        const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../pinStorage.ts'), 'utf-8')

        expect(source).toContain("new TextEncoder().encode('spndr-pin-verifier-salt-v1')")
        expect(source).toContain("new TextEncoder().encode('spndr-pin-verifier-v1')")
    })
})

/**
 * V7.1 new acceptance spec: PIN key copy-forward. `PIN_SALT_KEY`/`PIN_VERIFIER_KEY`/
 * `PIN_ATTEMPTS_KEY` rename from `spndr_pin_*` to `corvale_pin_*` (V7.3e). Unlike the KDF
 * context above, these are just localStorage key *names*, not cryptographic material - but a
 * bare rename would still strand every existing PIN, since `hasPinConfigured`/`verifyStoredPin`
 * would look under the new key and find nothing, and the encrypted local DB would look
 * permanently PIN-less rather than merely renamed. `migrateLegacyPinKeys()` is a one-time,
 * idempotent copy: if the legacy keys are present and the new keys are not, copy their values
 * forward under the new names and remove the legacy keys, so an upgraded build recognizes a PIN
 * set up before the rename without the user re-entering it.
 */
describe('PIN key copy-forward on rename (V7.3e rename shim)', () => {
    afterEach(() => {
        localStorage.clear()
    })

    it('copies a legacy-named salt/verifier forward to the new key names', async () => {
        localStorage.clear()
        localStorage.setItem(LEGACY_PIN_SALT_KEY, 'legacy-salt-b64')
        localStorage.setItem(LEGACY_PIN_VERIFIER_KEY, 'legacy-verifier-b64')

        migrateLegacyPinKeys()

        expect(localStorage.getItem(PIN_SALT_KEY)).toBe('legacy-salt-b64')
        expect(localStorage.getItem(PIN_VERIFIER_KEY)).toBe('legacy-verifier-b64')
        expect(localStorage.getItem(LEGACY_PIN_SALT_KEY)).toBeNull()
        expect(localStorage.getItem(LEGACY_PIN_VERIFIER_KEY)).toBeNull()
    })

    it('a PIN set up before the rename still verifies correctly after migration', async () => {
        localStorage.clear()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setLocalDb(new FakeEncryptableDb() as any)

        await setupPin('284915')
        // Simulate the rename landing: move the just-written keys back under the legacy names,
        // as if this profile had set up its PIN on a pre-rename build.
        const salt = localStorage.getItem(PIN_SALT_KEY)
        const verifier = localStorage.getItem(PIN_VERIFIER_KEY)
        localStorage.removeItem(PIN_SALT_KEY)
        localStorage.removeItem(PIN_VERIFIER_KEY)
        localStorage.setItem(LEGACY_PIN_SALT_KEY, salt!)
        localStorage.setItem(LEGACY_PIN_VERIFIER_KEY, verifier!)

        migrateLegacyPinKeys()

        expect(hasPinConfigured()).toBe(true)
        expect(await verifyStoredPin('284915')).toBe(true)

        resetLocalDbForTests()
    })

    it('is a no-op when only the new keys are present (already migrated / fresh install)', () => {
        localStorage.clear()
        localStorage.setItem(PIN_SALT_KEY, 'current-salt-b64')
        localStorage.setItem(PIN_VERIFIER_KEY, 'current-verifier-b64')

        migrateLegacyPinKeys()

        expect(localStorage.getItem(PIN_SALT_KEY)).toBe('current-salt-b64')
        expect(localStorage.getItem(PIN_VERIFIER_KEY)).toBe('current-verifier-b64')
    })

    it('never overwrites new keys that already exist, even if legacy keys are also present', () => {
        localStorage.clear()
        localStorage.setItem(PIN_SALT_KEY, 'current-salt-b64')
        localStorage.setItem(PIN_VERIFIER_KEY, 'current-verifier-b64')
        localStorage.setItem(LEGACY_PIN_SALT_KEY, 'stale-legacy-salt')
        localStorage.setItem(LEGACY_PIN_VERIFIER_KEY, 'stale-legacy-verifier')

        migrateLegacyPinKeys()

        expect(localStorage.getItem(PIN_SALT_KEY)).toBe('current-salt-b64')
        expect(localStorage.getItem(PIN_VERIFIER_KEY)).toBe('current-verifier-b64')
    })

    it('also copies forward the legacy attempts counter, so an active lockout survives the rename', () => {
        localStorage.clear()
        localStorage.setItem(LEGACY_PIN_SALT_KEY, 'legacy-salt-b64')
        localStorage.setItem(LEGACY_PIN_VERIFIER_KEY, 'legacy-verifier-b64')
        localStorage.setItem(LEGACY_PIN_ATTEMPTS_KEY, '5')

        migrateLegacyPinKeys()

        expect(localStorage.getItem('corvale_pin_attempts')).toBe('5')
        expect(localStorage.getItem(LEGACY_PIN_ATTEMPTS_KEY)).toBeNull()
    })
})

/**
 * V6: on a build where local-first is disabled (the web build), a device that once ran a flag-on
 * build keeps an orphaned salt/verifier/attempts trio in localStorage that no UI can clear
 * (PinGate/PinSettings are unmounted). `bootstrapLocalDb` calls `purgeLocalPinKeys()` on that
 * path. It must recognise BOTH the current `corvale_pin_*` names and the pre-rename `spndr_pin_*`
 * ones, since the affected population is exactly the pre-rename devices.
 */
describe('purgeLocalPinKeys (V6 orphaned-PIN cleanup on flag-off builds)', () => {
    afterEach(() => {
        localStorage.clear()
    })

    it('removes the current and legacy salt/verifier/attempts keys', () => {
        localStorage.clear()
        localStorage.setItem(PIN_SALT_KEY, 'salt')
        localStorage.setItem(PIN_VERIFIER_KEY, 'verifier')
        localStorage.setItem('corvale_pin_attempts', '2')
        localStorage.setItem(LEGACY_PIN_SALT_KEY, 'legacy-salt')
        localStorage.setItem(LEGACY_PIN_VERIFIER_KEY, 'legacy-verifier')
        localStorage.setItem(LEGACY_PIN_ATTEMPTS_KEY, '4')

        purgeLocalPinKeys()

        for (const key of [
            PIN_SALT_KEY,
            PIN_VERIFIER_KEY,
            'corvale_pin_attempts',
            LEGACY_PIN_SALT_KEY,
            LEGACY_PIN_VERIFIER_KEY,
            LEGACY_PIN_ATTEMPTS_KEY,
        ]) {
            expect(localStorage.getItem(key)).toBeNull()
        }
        expect(hasPinConfigured()).toBe(false)
    })

    it('leaves unrelated localStorage keys alone and is a no-op on a device that never set a PIN', () => {
        localStorage.clear()
        localStorage.setItem('corvale_something_else', 'keep me')

        expect(() => purgeLocalPinKeys()).not.toThrow()
        expect(localStorage.getItem('corvale_something_else')).toBe('keep me')
    })
})
