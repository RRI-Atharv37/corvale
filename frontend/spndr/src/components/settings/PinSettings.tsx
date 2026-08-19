import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { FiLock } from 'react-icons/fi'
import { clearPin, hasPinConfigured, setupPin, verifyStoredPin } from '../../offline/pinStorage'

const MIN_PIN_LENGTH = 4

/** Settings-modal panel for setting up, changing, or removing the local lock-screen PIN. */
const PinSettings: React.FC = () => {
    const [configured, setConfigured] = useState(hasPinConfigured())
    const [editing, setEditing] = useState(false)
    const [currentPin, setCurrentPin] = useState('')
    const [nextPin, setNextPin] = useState('')
    const [confirmPin, setConfirmPin] = useState('')
    const [saving, setSaving] = useState(false)

    const resetForm = () => {
        setCurrentPin('')
        setNextPin('')
        setConfirmPin('')
        setEditing(false)
    }

    const handleSave = async () => {
        if (nextPin.length < MIN_PIN_LENGTH) {
            toast.error(`PIN must be at least ${MIN_PIN_LENGTH} digits`)
            return
        }
        if (nextPin !== confirmPin) {
            toast.error('PINs do not match')
            return
        }
        if (configured) {
            const currentOk = await verifyStoredPin(currentPin)
            if (!currentOk) {
                toast.error('Current PIN is incorrect')
                return
            }
        }

        setSaving(true)
        try {
            await setupPin(nextPin)
            setConfigured(true)
            resetForm()
            toast.success(configured ? 'PIN updated' : 'PIN set up')
        } finally {
            setSaving(false)
        }
    }

    const handleRemove = () => {
        const confirmed = window.confirm(
            'Remove your local PIN? Your offline lock screen will no longer require one.'
        )
        if (!confirmed) return
        clearPin()
        setConfigured(false)
        resetForm()
        toast.success('PIN removed')
    }

    return (
        <div>
            <p className="section-label mb-3 flex items-center gap-2">
                <FiLock size={14} /> Local PIN lock
            </p>
            <p className="text-sm text-text-muted mb-3">
                A PIN protects your locally cached financial data when this device is offline.
            </p>

            {!editing ? (
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setEditing(true)}
                        className="rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-muted hover:text-accent hover:border-accent/40 transition-colors"
                    >
                        {configured ? 'Change PIN' : 'Set up PIN'}
                    </button>
                    {configured && (
                        <button
                            type="button"
                            onClick={handleRemove}
                            className="rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-muted hover:text-destructive hover:border-destructive/40 transition-colors"
                        >
                            Remove PIN
                        </button>
                    )}
                </div>
            ) : (
                <div className="space-y-3">
                    {configured && (
                        <label className="block text-sm text-text-secondary">
                            Current PIN
                            <input
                                type="password"
                                inputMode="numeric"
                                value={currentPin}
                                onChange={(event) => setCurrentPin(event.target.value)}
                                className="mt-2 w-full rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-accent/40 focus:outline-none"
                            />
                        </label>
                    )}
                    <label className="block text-sm text-text-secondary">
                        New PIN
                        <input
                            type="password"
                            inputMode="numeric"
                            value={nextPin}
                            onChange={(event) => setNextPin(event.target.value)}
                            className="mt-2 w-full rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-accent/40 focus:outline-none"
                        />
                    </label>
                    <label className="block text-sm text-text-secondary">
                        Confirm new PIN
                        <input
                            type="password"
                            inputMode="numeric"
                            value={confirmPin}
                            onChange={(event) => setConfirmPin(event.target.value)}
                            className="mt-2 w-full rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-accent/40 focus:outline-none"
                        />
                    </label>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => void handleSave()}
                            disabled={saving}
                            className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                        >
                            Save PIN
                        </button>
                        <button
                            type="button"
                            onClick={resetForm}
                            className="rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-muted"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

export default PinSettings
