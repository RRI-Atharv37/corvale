/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { api, onSessionEnded, refreshSession, setAccessToken } from './api'
import type { AdminIdentity, Session } from './types'

type Status = 'loading' | 'anonymous' | 'authenticated'

interface AuthState {
  status: Status
  admin: AdminIdentity | null
  capabilities: string[]
}

export interface AuthContextValue extends AuthState {
  hasCapability: (capability: string) => boolean
  login: (input: { email: string; password: string; totpCode?: string; recoveryCode?: string }) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const ANONYMOUS: AuthState = { status: 'anonymous', admin: null, capabilities: [] }

const fromSession = (session: Session): AuthState => ({
  status: 'authenticated',
  admin: session.admin,
  capabilities: session.capabilities ?? [],
})

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<AuthState>({ status: 'loading', admin: null, capabilities: [] })

  useEffect(() => {
    let active = true
    onSessionEnded(() => setState(ANONYMOUS))

    // The refresh cookie is httpOnly, so the only way to know whether a session exists is to ask.
    refreshSession().then((session) => {
      if (active) setState(session ? fromSession(session) : ANONYMOUS)
    })

    return () => {
      active = false
      onSessionEnded(null)
    }
  }, [])

  const login = useCallback<AuthContextValue['login']>(async (input) => {
    setState(fromSession(await api.login(input)))
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      setAccessToken(null)
      setState(ANONYMOUS)
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, hasCapability: (capability) => state.capabilities.includes(capability), login, logout }),
    [state, login, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = (): AuthContextValue => {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
