import type { User } from '@lib/types/api'

/**
 * Durable cache of the last-known `User` record, read on boot so the app can render
 * immediately instead of hanging on a spinner while the network is unreachable (see
 * `UserContext.restoreSession`). Backed by localStorage today; a future sprint can move
 * this onto the local SQLite `User` row without changing this module's contract.
 */

const CACHED_USER_KEY = 'corvale_cached_user'

export const getCachedUser = (): User | null => {
    const raw = localStorage.getItem(CACHED_USER_KEY)
    if (!raw) return null
    try {
        return JSON.parse(raw) as User
    } catch {
        return null
    }
}

export const setCachedUser = (user: User | null): void => {
    if (!user) {
        localStorage.removeItem(CACHED_USER_KEY)
        return
    }
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user))
}
