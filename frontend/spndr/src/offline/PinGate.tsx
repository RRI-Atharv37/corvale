import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PinUnlock from './PinUnlock'
import { hasPinConfigured, verifyStoredPin } from './pinStorage'
import { wipeLocalData } from './wipeLocalData'
import { isLocalFirstEnabled } from '../utils/localFirstFlag'

const SESSION_UNLOCKED_KEY = 'spndr_pin_unlocked'

/**
 * Wraps the dashboard so a configured PIN gates access to local financial data on each new
 * browser session (tab reload / reopen), not on every in-app navigation. If no PIN has been
 * set up, or local-first is off, this is a no-op passthrough.
 */
const PinGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const navigate = useNavigate()
    const [unlockedThisSession, setUnlockedThisSession] = useState(
        () => sessionStorage.getItem(SESSION_UNLOCKED_KEY) === '1'
    )

    if (!isLocalFirstEnabled() || !hasPinConfigured() || unlockedThisSession) {
        return <>{children}</>
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
        <PinUnlock
            verifyPin={verifyStoredPin}
            onUnlocked={() => {
                sessionStorage.setItem(SESSION_UNLOCKED_KEY, '1')
                setUnlockedThisSession(true)
            }}
            onForgotPin={() => void handleForgotPin()}
        >
            {children}
        </PinUnlock>
    )
}

export default PinGate
