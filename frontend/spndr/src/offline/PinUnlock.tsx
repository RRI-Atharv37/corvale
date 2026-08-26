import React, { useState } from 'react'

const MAX_ATTEMPTS = 5
const INPUT_ID = 'pin-unlock-input'

export interface PinUnlockProps {
    verifyPin: (pin: string) => boolean | Promise<boolean>
    onUnlocked: () => void
    children: React.ReactNode
    onForgotPin?: () => void
}

/**
 * Gate component: hides `children` behind a PIN prompt until `verifyPin` accepts an entry.
 * Locks out locally after `MAX_ATTEMPTS` wrong guesses in this mount, for immediate UI
 * feedback. `verifyPin` (`pinStorage.verifyStoredPin`) additionally enforces its own
 * *persisted* lockout that survives a remount - a rejected promise means that persisted
 * counter has already maxed out, so it's surfaced the same way rather than crashing.
 */
const PinUnlock: React.FC<PinUnlockProps> = ({ verifyPin, onUnlocked, children, onForgotPin }) => {
    const [pin, setPin] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [attempts, setAttempts] = useState(0)
    const [hardLocked, setHardLocked] = useState(false)
    const [unlocked, setUnlocked] = useState(false)
    const [checking, setChecking] = useState(false)

    const lockedOut = hardLocked || attempts >= MAX_ATTEMPTS

    if (unlocked) {
        return <>{children}</>
    }

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        if (lockedOut || checking) return

        setChecking(true)
        setError(null)
        try {
            const ok = await verifyPin(pin)
            if (ok) {
                setUnlocked(true)
                onUnlocked()
                return
            }

            const nextAttempts = attempts + 1
            setAttempts(nextAttempts)
            setPin('')
            setError(
                nextAttempts >= MAX_ATTEMPTS
                    ? 'Too many attempts. Locked out - use "Forgot PIN?" to reset and resync.'
                    : 'Incorrect PIN. Please try again.'
            )
        } catch (err) {
            setHardLocked(true)
            setPin('')
            setError(err instanceof Error ? err.message : 'Too many attempts. Locked out - use "Forgot PIN?" to reset and resync.')
        } finally {
            setChecking(false)
        }
    }

    return (
        <div className="min-h-screen bg-page flex items-center justify-center px-4">
            <form
                onSubmit={(event) => void handleSubmit(event)}
                className="w-full max-w-sm rounded-lg border border-border-subtle bg-elevated p-6 space-y-4"
            >
                <div>
                    <h1 className="font-display text-lg font-semibold text-text-primary">Enter your PIN</h1>
                    <p className="text-sm text-text-muted mt-1">Unlock your local financial data to continue.</p>
                </div>

                <label htmlFor={INPUT_ID} className="block text-sm text-text-secondary">
                    PIN
                    <input
                        id={INPUT_ID}
                        type="password"
                        inputMode="numeric"
                        autoComplete="off"
                        value={pin}
                        onChange={(event) => setPin(event.target.value)}
                        disabled={lockedOut || checking}
                        className="mt-2 w-full rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-accent/40 focus:outline-none"
                    />
                </label>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <button
                    type="submit"
                    disabled={lockedOut || checking}
                    className="w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                >
                    Unlock
                </button>

                {onForgotPin && (
                    <button
                        type="button"
                        onClick={onForgotPin}
                        className="w-full text-center text-xs text-text-muted hover:text-accent transition-colors"
                    >
                        Forgot PIN?
                    </button>
                )}
            </form>
        </div>
    )
}

export default PinUnlock
