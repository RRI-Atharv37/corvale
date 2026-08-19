import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import axiosInstance from '../utils/axiosInstance'
import { API_PATHS } from '../utils/apiPaths'
import type { ApiResponse, AuthPayload, User } from '../types/api'
import { unwrapApiData } from '../utils/apiHelpers'
import { getApiErrorMessage } from '../utils/apiError'
import { resetPreferredCurrency, resetDateFormat, setDateFormat, setPreferredCurrency } from '../utils/format'
import { getCachedUser, setCachedUser } from '../offline/cachedUser'
import {
    clearSessionValidUntil,
    getSessionValidUntil,
    isLocalSessionValid,
    setSessionValidUntil,
} from '../offline/sessionPolicy'
import { isNetworkError } from '../offline/reachability'
import { wipeLocalData } from '../offline/wipeLocalData'
import { exportUnsyncedOps } from '../offline/exportUnsyncedOps'
import { handleTokenRevoked, TOKEN_REVOKED_EVENT } from '../offline/tokenRevokedFlow'
import { getSyncStatus } from '../sync/syncEngine'

interface UserContextType {
    user: User | null
    isAuthenticated: boolean
    isInitializing: boolean
    updateUser: (user: User) => void
    clearUser: () => void
    logout: () => Promise<void>
    logoutAllSessions: () => Promise<void>
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
        localStorage.removeItem('token')
        clearSessionValidUntil()
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

    const restoreSession = useCallback(async () => {
        const token = localStorage.getItem('token')

        if (!token) {
            setIsInitializing(false)
            return
        }

        try {
            const response = await axiosInstance.get<ApiResponse<User>>(API_PATHS.AUTH.USER)
            const userData = unwrapApiData(response)
            applyUser(userData)
            setSessionValidUntil()
        } catch (error) {
            // A network failure (no server response reached us) is not proof the session is
            // invalid - it just means we can't check. Fall back to the last-known cached user
            // rather than logging the user out, as long as the local session window (set at
            // login, independent of the 15m/7d JWT lifetimes) hasn't run out. A genuine auth
            // rejection (401 with a response) is not a network failure and still clears the
            // session normally.
            const offline = !navigator.onLine || isNetworkError(error)
            const cached = offline ? getCachedUser() : null
            const validUntil = getSessionValidUntil()
            const cachedSessionUsable = validUntil === null || isLocalSessionValid(validUntil)

            if (cached && cachedSessionUsable) {
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
            restoreSession,
        }),
        [user, isInitializing, updateUser, clearUser, logout, logoutAllSessions, restoreSession]
    )

    return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

export default UserProvider

export const setAuthSession = (payload: AuthPayload): void => {
    localStorage.setItem('token', payload.token)
    setSessionValidUntil()
}

export const parseAuthPayload = (response: ApiResponse<AuthPayload> | AuthPayload): AuthPayload => {
    const data = unwrapApiData(response)

    if ('token' in data && 'user' in data) {
        return data
    }

    throw new Error('Invalid auth response from server')
}
