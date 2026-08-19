import { resetLocalData } from '../sync/syncEngine'
import { setCachedUser } from './cachedUser'
import { clearSessionValidUntil } from './sessionPolicy'
import { clearPin } from './pinStorage'

/**
 * Full local wipe: the local SQLite store (data + outbox + conflicts + checkpoint, via
 * `resetLocalData`) plus everything auth/session-related that `resetLocalData` deliberately
 * leaves alone - cached user, local session window, and PIN material. Used by offline logout,
 * the post-reconnect `TOKEN_REVOKED` flow, and the forgotten-PIN recovery path.
 */
export const wipeLocalData = async (): Promise<void> => {
    try {
        await resetLocalData()
    } catch {
        // Local DB unavailable (e.g. local-first disabled in this build) - nothing there to wipe.
    }
    setCachedUser(null)
    clearSessionValidUntil()
    clearPin()
    localStorage.removeItem('token')
}
