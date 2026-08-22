import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as deriveKeyModule from '../../db/encryption/deriveKey'
import { resetLocalDbForTests, setLocalDb } from '../../db/localDbInstance'
import { clearPin, hasPinConfigured, setupPin, verifyStoredPin } from '../pinStorage'

/**
 * G1 acceptance spec (TODO.md T1 -> S9, SEC-02).
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

const PIN_SALT_KEY = 'spndr_pin_salt'
const PIN_VERIFIER_KEY = 'spndr_pin_verifier'

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
