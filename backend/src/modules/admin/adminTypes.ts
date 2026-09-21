import type { AdminRole } from './adminRoles'

/** The authenticated admin for one request, resolved from the access token and the server-side session. */
export interface AdminPrincipal {
    id: string
    email: string
    role: AdminRole
    sessionId: string
    stepUpAt: Date | null
    moneyBlockedUntil: Date | null
    sessionExpiresAt: Date
    idleExpiresAt: Date
}

export interface AdminRequestContext {
    ip: string | null
    requestId: string | null
}
