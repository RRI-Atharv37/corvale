import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import axiosInstance from '../utils/axiosInstance'
import { API_PATHS } from '../utils/apiPaths'
import type { ApiResponse, AuthPayload, User } from '../types/api'
import { unwrapApiData } from '../utils/apiHelpers'
import { getApiErrorMessage } from '../utils/apiError'

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

    const clearUser = useCallback(() => {
        setUser(null)
        localStorage.removeItem('token')
    }, [])

    const updateUser = useCallback((userData: User) => {
        setUser(userData)
    }, [])

    const logout = useCallback(async () => {
        try {
            await axiosInstance.post(API_PATHS.AUTH.LOGOUT)
        } catch {
            // Clear local session even if the server call fails
        }
        clearUser()
    }, [clearUser])

    const logoutAllSessions = useCallback(async () => {
        try {
            await axiosInstance.post(API_PATHS.AUTH.LOGOUT_ALL)
        } catch {
            // Clear local session even if the server call fails
        }
        clearUser()
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
            setUser(userData)
        } catch (error) {
            clearUser()
            console.error('Session restore failed:', getApiErrorMessage(error))
        } finally {
            setIsInitializing(false)
        }
    }, [clearUser])

    useEffect(() => {
        void restoreSession()
    }, [restoreSession])

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
}

export const parseAuthPayload = (response: ApiResponse<AuthPayload> | AuthPayload): AuthPayload => {
    const data = unwrapApiData(response)

    if ('token' in data && 'user' in data) {
        return data
    }

    throw new Error('Invalid auth response from server')
}
