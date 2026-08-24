import { resetLocalData } from '../sync/syncEngine'
import { setCachedUser } from './cachedUser'
import { clearOfflineGrant } from './offlineGrant'
import { clearLocalEncryptionKey, clearPin } from './pinStorage'
import { setAccessToken } from '../utils/tokenStore'

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
export const wipeLocalData = async (): Promise<void> => {
    await clearLocalEncryptionKey()
    try {
        await resetLocalData()
    } catch {
        // Local DB unavailable (e.g. local-first disabled in this build) - nothing there to wipe.
    }
    setCachedUser(null)
    clearOfflineGrant()
    clearPin()
    setAccessToken(null)
}
