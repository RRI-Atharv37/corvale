/**
 * Dispatched by `axiosInstance`'s response interceptor whenever a 401 clears the in-memory
 * access token, for any reason - `UserContext` listens and clears its own state so
 * `ProtectedRoute` stops rendering a stale authenticated shell and redirects to `/login` instead
 * (BUG-07). Deliberately broader than `TOKEN_REVOKED_EVENT` (`offline/tokenRevokedFlow.ts`),
 * which only covers an explicit server-side revocation and triggers the export-before-wipe
 * offline flow - this one fires alongside it there, and alone for every other session-ending 401
 * (an expired token whose refresh also fails, or any other unrefreshable 401).
 */
export const SESSION_EXPIRED_EVENT = 'corvale:session-expired'
