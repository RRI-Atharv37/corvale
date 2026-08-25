import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import axiosInstance from '../utils/axiosInstance'
import { API_PATHS } from '../utils/apiPaths'
import type { ApiResponse, AuthPayload, User } from '../types/api'
import { unwrapApiData } from '../utils/apiHelpers'
import { getApiErrorMessage } from '../utils/apiError'
import { resetPreferredCurrency, resetDateFormat, setDateFormat, setPreferredCurrency } from '../utils/format'
import { getCachedUser, setCachedUser } from '../offline/cachedUser'
import { setAccessToken } from '../utils/tokenStore'
import { clearOfflineGrant, getStoredOfflineGrant, storeOfflineGrant, verifyOfflineGrant } from '../offline/offlineGrant'
import { isNetworkError } from '../offline/reachability'
import { wipeLocalData } from '../offline/wipeLocalData'
import { exportUnsyncedOps } from '../offline/exportUnsyncedOps'
import { handleTokenRevoked, TOKEN_REVOKED_EVENT } from '../offline/tokenRevokedFlow'
import { getSyncStatus } from '../sync/syncEngine'
import { provisionLocalDb } from '../db/provisionLocalDb'

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
    }, [applyUser])

    const updateUser = useCallback(
        (userData: User) => {
            applyUser(userData)
        },
        [applyUser]
    )

    const logout = useCallback(async () => {
        try {
            await axiosInstance.post(API_PATHS.AUTH.LOGOUT)
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
            const response = await axiosInstance.post<ApiResponse<AuthPayload>>(API_PATHS.AUTH.REFRESH)
            const payload = parseAuthPayload(response)
            setAccessToken(payload.token)
            applyUser(payload.user)
            storeOfflineGrant(payload.offlineGrant)
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
    await provisionLocalDb()
}

export const parseAuthPayload = (response: ApiResponse<AuthPayload> | AuthPayload): AuthPayload => {
    const data = unwrapApiData(response)

    if ('token' in data && 'user' in data) {
        return data
    }

    throw new Error('Invalid auth response from server')
}
