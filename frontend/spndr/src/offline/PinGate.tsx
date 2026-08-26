import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PinUnlock from './PinUnlock'
import { LOCAL_DB_LOCKED_EVENT, hasPinConfigured, isLocalDbUnlocked, lockLocalDb, verifyStoredPin } from './pinStorage'
import { wipeLocalData } from './wipeLocalData'
import { isLocalFirstEnabled } from '../utils/localFirstFlag'

/** Tab hidden this long or more before returning re-locks the local DB (S10, SEC-03). */
const HIDE_TIMEOUT_MS = 5 * 60 * 1000

type GateStatus = 'unlocked' | 'locked' | 'checking'

/**
 * Wraps the dashboard so a configured PIN gates access to local financial data. Unlike the
 * previous `sessionStorage`-flag gate, "unlocked" here is a *consequence* of the local DB
 * actually holding its derived encryption key (`isLocalDbUnlocked`) - a storage flag alone can
 * no longer render children with the data still sitting behind a key nobody derived this
 * session. If no PIN has been set up, or local-first is off, this is a no-op passthrough.
 */
const PinGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const navigate = useNavigate()
    const gateActive = isLocalFirstEnabled() && hasPinConfigured()
    const [status, setStatus] = useState<GateStatus>(gateActive ? 'checking' : 'unlocked')

    useEffect(() => {
        if (!gateActive) return
        let cancelled = false
        void isLocalDbUnlocked().then((unlocked) => {
            if (!cancelled) setStatus(unlocked ? 'unlocked' : 'locked')
        })
        return () => {
            cancelled = true
        }
    }, [gateActive])

    useEffect(() => {
        if (!gateActive) return
        const onLocked = () => setStatus('locked')
        window.addEventListener(LOCAL_DB_LOCKED_EVENT, onLocked)
        return () => window.removeEventListener(LOCAL_DB_LOCKED_EVENT, onLocked)
    }, [gateActive])

    useEffect(() => {
        if (!gateActive) return
        let hiddenAt: number | null = null
        const onVisibilityChange = () => {
            if (document.hidden) {
                hiddenAt = Date.now()
                return
            }
            const wasHiddenLongEnough = hiddenAt !== null && Date.now() - hiddenAt >= HIDE_TIMEOUT_MS
            hiddenAt = null
            if (wasHiddenLongEnough) {
                void lockLocalDb()
            }
        }
        document.addEventListener('visibilitychange', onVisibilityChange)
        return () => document.removeEventListener('visibilitychange', onVisibilityChange)
    }, [gateActive])

    if (status === 'unlocked') {
        return <>{children}</>
    }

    if (status === 'checking') {
        return null
    }

    const handleForgotPin = async () => {
        const confirmed = window.confirm(
            'Resetting your PIN wipes all local offline data on this device, including any changes made ' +
                "while offline that haven't synced yet. Continue?"
        )
        if (!confirmed) return

        await wipeLocalData()
        navigate('/login', { replace: true })
    }

    return (
        <PinUnlock verifyPin={verifyStoredPin} onUnlocked={() => setStatus('unlocked')} onForgotPin={() => void handleForgotPin()}>
            {children}
        </PinUnlock>
    )
}

export default PinGate
