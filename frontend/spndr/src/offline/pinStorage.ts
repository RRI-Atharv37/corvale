import { getLocalDb } from '../db/localDbInstance'

/**
 * PIN-gated local unlock. The PIN itself is never stored - only a salted SHA-256 verifier,
 * so a wrong guess can be rejected without touching the SQLite worker. On a correct PIN, the
 * same PIN + salt are handed to the worker to derive the AES-GCM key that encrypts local
 * fields (`db/encryption/deriveKey.ts`), so entering the PIN is also what unlocks the data,
 * not just the UI.
 */

const PIN_SALT_KEY = 'spndr_pin_salt'
const PIN_VERIFIER_KEY = 'spndr_pin_verifier'

interface EncryptionCapableDb {
    setEncryptionKey: (passphrase: string, salt: Uint8Array) => Promise<void>
}

const hasEncryptionSupport = (db: unknown): db is EncryptionCapableDb =>
    typeof db === 'object' && db !== null && typeof (db as Partial<EncryptionCapableDb>).setEncryptionKey === 'function'

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes))
const fromBase64 = (value: string): Uint8Array => Uint8Array.from(atob(value), (char) => char.charCodeAt(0))

const hashPin = async (pin: string, salt: Uint8Array): Promise<string> => {
    const data = new TextEncoder().encode(`${pin}:${toBase64(salt)}`)
    const digest = await crypto.subtle.digest('SHA-256', data)
    return toBase64(new Uint8Array(digest))
}

const applyEncryptionKey = async (pin: string, salt: Uint8Array): Promise<void> => {
    try {
        const db = await getLocalDb()
        if (hasEncryptionSupport(db)) {
            await db.setEncryptionKey(pin, salt)
        }
    } catch {
        // Local DB unavailable (e.g. local-first disabled in this build) - the PIN still gates the UI.
    }
}

export const hasPinConfigured = (): boolean => localStorage.getItem(PIN_VERIFIER_KEY) !== null

export const setupPin = async (pin: string): Promise<void> => {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const verifier = await hashPin(pin, salt)
    localStorage.setItem(PIN_SALT_KEY, toBase64(salt))
    localStorage.setItem(PIN_VERIFIER_KEY, verifier)
    await applyEncryptionKey(pin, salt)
}

export const verifyStoredPin = async (pin: string): Promise<boolean> => {
    const saltB64 = localStorage.getItem(PIN_SALT_KEY)
    const verifier = localStorage.getItem(PIN_VERIFIER_KEY)
    if (!saltB64 || !verifier) return false

    const salt = fromBase64(saltB64)
    const candidate = await hashPin(pin, salt)
    const matches = candidate === verifier
    if (matches) {
        await applyEncryptionKey(pin, salt)
    }
    return matches
}

export const clearPin = (): void => {
    localStorage.removeItem(PIN_SALT_KEY)
    localStorage.removeItem(PIN_VERIFIER_KEY)
}
