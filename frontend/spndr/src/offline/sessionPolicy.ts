/**
 * Local session validity, independent of JWT expiry. Access tokens are 15m and refresh
 * tokens 7d (see `backend/.env` docs), so neither survives a real offline period - a user
 * who goes offline for a weekend would otherwise be locked out the moment their cached
 * `User` is trusted for boot rendering. `sessionValidUntil` is a separate, longer-lived
 * local policy: set (and rolled forward) whenever the app successfully talks to the server,
 * and consulted only as a fallback when the network/token check itself can't run.
 */

export const DEFAULT_SESSION_VALID_DAYS = 30

const SESSION_VALID_UNTIL_KEY = 'spndr_session_valid_until'

/** A session is valid strictly before `sessionValidUntil` - the exact expiry instant counts as expired. */
export const isLocalSessionValid = (sessionValidUntil: string | null, now: Date = new Date()): boolean => {
    if (!sessionValidUntil) return false
    const validUntil = new Date(sessionValidUntil)
    if (Number.isNaN(validUntil.getTime())) return false
    return now.getTime() < validUntil.getTime()
}

export const getSessionValidUntil = (): string | null => localStorage.getItem(SESSION_VALID_UNTIL_KEY)

/** Rolls the local session window forward `days` from `from` (default: now). Called on login and on every successful online session check. */
export const setSessionValidUntil = (days: number = DEFAULT_SESSION_VALID_DAYS, from: Date = new Date()): void => {
    const validUntil = new Date(from.getTime() + days * 24 * 60 * 60 * 1000)
    localStorage.setItem(SESSION_VALID_UNTIL_KEY, validUntil.toISOString())
}

export const clearSessionValidUntil = (): void => {
    localStorage.removeItem(SESSION_VALID_UNTIL_KEY)
}
