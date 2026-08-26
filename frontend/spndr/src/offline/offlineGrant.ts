import { importSPKI, jwtVerify } from 'jose'

/**
 * Server-signed offline session grant (S16, SEC-18). Replaces the old plain
 * `spndr_session_valid_until` localStorage date, which a user could simply rewrite to extend
 * their own offline access forever, with a JWT the server signs (`backend/utils/offlineGrantUtils.ts`)
 * and this module verifies locally with the matching public key - the client holds no key
 * capable of minting or extending one itself. Every successful login/refresh rolls the grant
 * forward; `UserContext.restoreSession` consults it only when the server can't be reached.
 */

const OFFLINE_GRANT_KEY = 'spndr_offline_grant'
const OFFLINE_GRANT_ALGORITHM = 'ES256'

export const storeOfflineGrant = (grant: string | null | undefined): void => {
    if (!grant) {
        localStorage.removeItem(OFFLINE_GRANT_KEY)
        return
    }
    localStorage.setItem(OFFLINE_GRANT_KEY, grant)
}

export const getStoredOfflineGrant = (): string | null => localStorage.getItem(OFFLINE_GRANT_KEY)

export const clearOfflineGrant = (): void => localStorage.removeItem(OFFLINE_GRANT_KEY)

const getPublicKey = async (): Promise<CryptoKey | null> => {
    const pem = import.meta.env.VITE_OFFLINE_GRANT_PUBLIC_KEY
    if (!pem) return null
    try {
        return await importSPKI(pem.replace(/\\n/g, '\n'), OFFLINE_GRANT_ALGORITHM)
    } catch {
        return null
    }
}

/**
 * Fails closed: a missing grant, a missing/invalid public key, a tampered signature, a grant
 * bound to a different user, or an expired `exp` all return false. There is no default-allow
 * path - unlike the old plain date, a device with no grant at all gets no offline fallback.
 */
export const verifyOfflineGrant = async (
    grant: string | null,
    expectedUserId?: string
): Promise<boolean> => {
    if (!grant) return false

    const key = await getPublicKey()
    if (!key) return false

    try {
        const { payload } = await jwtVerify(grant, key, { algorithms: [OFFLINE_GRANT_ALGORITHM] })
        if (expectedUserId && payload.sub !== expectedUserId) return false
        return true
    } catch {
        return false
    }
}
