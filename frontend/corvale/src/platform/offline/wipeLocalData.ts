import { resetLocalData } from '../sync/syncEngine'
import { setCachedUser } from './cachedUser'
import { clearOfflineGrant } from '@lib/offlineGrant'
import { clearLocalEncryptionKey, hasAnyPinMaterial, purgeLocalPinKeys } from './pinStorage'
import { setAccessToken } from '@lib/tokenStore'

export interface WipeResult {
    /** BUG-30: a local PIN verifier was present and has now been cleared - callers on a
     *  user-initiated wipe surface a notice so the removal isn't silent. */
    pinCleared: boolean
}

/**
 * Full local wipe: the local SQLite store (data + outbox + conflicts + checkpoint, via
 * `resetLocalData`) plus everything auth/session-related that `resetLocalData` deliberately
 * leaves alone - cached user, local session window, and PIN material. Used by offline logout,
 * the post-reconnect `TOKEN_REVOKED` flow, and the forgotten-PIN recovery path.
 *
 * The encryption key is cleared explicitly (S10, SEC-03) rather than relying on
 * `resetLocalData` to do it as a side effect - it only deletes table rows, not the key held by
 * the driver.
 */
export const wipeLocalData = async (): Promise<WipeResult> => {
    await clearLocalEncryptionKey()
    try {
        await resetLocalData()
    } catch {
        // Local DB unavailable (e.g. local-first disabled in this build) - nothing there to wipe.
    }
    const pinCleared = hasAnyPinMaterial()
    setCachedUser(null)
    clearOfflineGrant()
    // Clears both the current `corvale_pin_*` and pre-rename `spndr_pin_*` verifier/salt/attempts
    // keys - a plain `clearPin()` would leave a legacy-named verifier behind on a device that
    // hasn't run `migrateLegacyPinKeys` yet.
    purgeLocalPinKeys()
    setAccessToken(null)
    return { pinCleared }
}
