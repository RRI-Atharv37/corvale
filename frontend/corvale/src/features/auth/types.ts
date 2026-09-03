import type { User } from '@lib/types/api'

export interface AuthPayload {
    token: string
    user: User
    offlineGrant?: string
    /**
     * Only present for the desktop (Tauri) client (SEC-11 / BUG-24): the rotated refresh token,
     * to persist in the OS keychain. The web app never receives this - it uses the httpOnly
     * refresh cookie.
     */
    refreshToken?: string
}
