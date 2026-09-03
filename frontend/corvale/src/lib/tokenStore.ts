/**
 * In-memory-only access token (S16, SEC-18). Previously `localStorage.getItem/setItem('token')`
 * - readable by any script on the page indefinitely, including long after the tab closed and
 * reopened. Keeping it here instead means a reload discards it; the httpOnly refresh cookie is
 * what makes session restore across a reload possible (`UserContext.restoreSession`), not a
 * persisted token.
 */
let accessToken: string | null = null

export const getAccessToken = (): string | null => accessToken

export const setAccessToken = (token: string | null): void => {
    accessToken = token
}
