import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import axiosInstance from '../utils/axiosInstance'
import { API_PATHS } from '../utils/apiPaths'
import type { ApiResponse, AuthPayload, User } from '../types/api'
import { unwrapApiData } from '../utils/apiHelpers'
import { getApiErrorMessage } from '../utils/apiError'
import { resetPreferredCurrency, resetDateFormat, setDateFormat, setPreferredCurrency } from '../utils/format'
import { getCachedUser, setCachedUser } from '../offline/cachedUser'
import { setAccessToken } from '../utils/tokenStore'
import { clearStoredRefreshToken, getStoredRefreshToken, storeRefreshToken } from '../utils/refreshTokenStore'
import { clearOfflineGrant, getStoredOfflineGrant, storeOfflineGrant, verifyOfflineGrant } from '../offline/offlineGrant'
import { isNetworkError } from '../offline/reachability'
import { wipeLocalData } from '../offline/wipeLocalData'
import { exportUnsyncedOps } from '../offline/exportUnsyncedOps'
import { handleTokenRevoked, TOKEN_REVOKED_EVENT } from '../offline/tokenRevokedFlow'
import { getSyncStatus } from '../sync/syncEngine'
import { provisionLocalDb } from '../db/provisionLocalDb'
import { SESSION_EXPIRED_EVENT } from '../utils/sessionEvents'

interface UserContextType {
    user: User | null
    isAuthenticated: boolean
    isInitializing: boolean
    updateUser: (user: User) => void
    clearUser: () => void
    logout: () => Promise<void>
    logoutAllSessions: () => Promise<void>
    deleteAccount: (password: string) => Promise<void>
    restoreSession: () => Promise<void>
}

export const UserContext = createContext<UserContextType | null>(null)

const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null)
    const [isInitializing, setIsInitializing] = useState(true)

    const applyUser = useCallback((userData: User | null) => {
        setUser(userData)
        setCachedUser(userData)
        if (userData?.preferredCurrency) {
            setPreferredCurrency(userData.preferredCurrency)
        } else {
            resetPreferredCurrency()
        }

        if (userData?.dateFormat) {
            setDateFormat(userData.dateFormat)
        } else {
            resetDateFormat()
        }
    }, [])

    const clearUser = useCallback(() => {
        applyUser(null)
        setAccessToken(null)
        clearOfflineGrant()
        // Desktop keychain-held refresh token (SEC-11 / BUG-24); no-op on the web.
        void clearStoredRefreshToken()
    }, [applyUser])

    const updateUser = useCallback(
        (userData: User) => {
            applyUser(userData)
        },
        [applyUser]
    )

    const logout = useCallback(async () => {
        try {
            // Desktop sends its keychain-held refresh token so the server can revoke it
            // (SEC-11 / BUG-24); on the web this is null and the cookie is revoked instead.
            const refreshToken = await getStoredRefreshToken()
            await axiosInstance.post(API_PATHS.AUTH.LOGOUT, refreshToken ? { refreshToken } : undefined)
        } catch {
            // Clear local session even if the server call fails (e.g. offline)
        }
        clearUser()
        await wipeLocalData()
    }, [clearUser])

    const logoutAllSessions = useCallback(async () => {
        try {
            await axiosInstance.post(API_PATHS.AUTH.LOGOUT_ALL)
        } catch {
            // Clear local session even if the server call fails (e.g. offline)
        }
        clearUser()
        await wipeLocalData()
    }, [clearUser])

    const deleteAccount = useCallback(async (password: string) => {
        await axiosInstance.delete(API_PATHS.AUTH.DELETE_ACCOUNT, { data: { password } })
        clearUser()
        await wipeLocalData()
    }, [clearUser])

    const restoreSession = useCallback(async () => {
        // The access token lives in memory only (S16, SEC-18) and is gone after a reload, so
        // boot always goes through the httpOnly refresh cookie rather than checking for a
        // stored token first. The response carries a fresh token, the user, and a rolled-forward
        // offline grant in one round trip.
        try {
            const storedRefreshToken = await getStoredRefreshToken()
            const response = await axiosInstance.post<ApiResponse<AuthPayload>>(
                API_PATHS.AUTH.REFRESH,
                storedRefreshToken ? { refreshToken: storedRefreshToken } : undefined
            )
            const payload = parseAuthPayload(response)
            setAccessToken(payload.token)
            applyUser(payload.user)
            storeOfflineGrant(payload.offlineGrant)
            if (payload.refreshToken) {
                await storeRefreshToken(payload.refreshToken)
            }
        } catch (error) {
            // A network failure (no server response reached us) is not proof the session is
            // invalid - it just means we can't check. Fall back to the last-known cached user,
            // but only when the signed offline grant actually verifies for that cached user -
            // unlike the old plain expiry date, there is no default-allow path here. A genuine
            // auth rejection (401 with a response, e.g. no/expired refresh cookie) is not a
            // network failure and still clears the session normally.
            const offline = !navigator.onLine || isNetworkError(error)
            const cached = offline ? getCachedUser() : null
            const grantValid = cached ? await verifyOfflineGrant(getStoredOfflineGrant(), cached._id) : false

            if (cached && grantValid) {
                applyUser(cached)
            } else {
                clearUser()
            }
            console.error('Session restore failed:', getApiErrorMessage(error))
        } finally {
            setIsInitializing(false)
        }
    }, [applyUser, clearUser])

    useEffect(() => {
        void restoreSession()
    }, [restoreSession])

    useEffect(() => {
        const onTokenRevoked = () => {
            void (async () => {
                let hasUnsyncedChanges = false
                try {
                    const status = await getSyncStatus()
                    hasUnsyncedChanges = status.pendingCount > 0
                } catch {
                    // Local-first disabled / local DB unavailable - nothing to check or export.
                }
                await handleTokenRevoked({
                    hasUnsyncedChanges,
                    onExportOffer: exportUnsyncedOps,
                    wipe: wipeLocalData,
                })
                clearUser()
            })()
        }

        window.addEventListener(TOKEN_REVOKED_EVENT, onTokenRevoked)
        return () => window.removeEventListener(TOKEN_REVOKED_EVENT, onTokenRevoked)
    }, [clearUser])

    useEffect(() => {
        const onSessionExpired = () => {
            clearUser()
            toast.error('Your session has expired. Please sign in again.')
        }

        window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired)
        return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired)
    }, [clearUser])

    const value = useMemo(
        () => ({
            user,
            isAuthenticated: !!user,
            isInitializing,
            updateUser,
            clearUser,
            logout,
            logoutAllSessions,
            deleteAccount,
            restoreSession,
        }),
        [
            user,
            isInitializing,
            updateUser,
            clearUser,
            logout,
            logoutAllSessions,
            deleteAccount,
            restoreSession,
        ]
    )

    return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

export default UserProvider

/** Called on Login/Signup - the "online sign-in" moment D5's local DB provisioning hooks into. */
export const setAuthSession = async (payload: AuthPayload): Promise<void> => {
    setAccessToken(payload.token)
    storeOfflineGrant(payload.offlineGrant)
    // Desktop only (SEC-11 / BUG-24): stash the refresh token in the OS keychain so the session
    // survives past the access-token TTL and across relaunches. No-op on the web.
    await storeRefreshToken(payload.refreshToken)
    await provisionLocalDb()
}

export const parseAuthPayload = (response: ApiResponse<AuthPayload> | AuthPayload): AuthPayload => {
    const data = unwrapApiData(response)

    if ('token' in data && 'user' in data) {
        return data
    }

    throw new Error('Invalid auth response from server')
}
