import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../ui/Modal'
import { MIN_PIN_LENGTH, hasPinConfigured, setupPin } from '../../offline/pinStorage'
import { isLocalPinEnabled } from '../../utils/localPinFlag'
import { getApiErrorMessage } from '../../utils/apiError'
import { BRAND } from '../../utils/brand'

const PROMPT_SEEN_KEY = 'corvale_pin_prompt_seen'

// Onboarding's own wizard modal (`OnboardingWizard`) manages its visibility internally and
// doesn't expose it, so this prompt is staggered behind a short delay instead of reacting to
// that modal's state directly - long enough that the wizard (which checks onboarding status
// immediately on mount) has already opened first if it's going to.
const OPEN_DELAY_MS = 1500

/**
 * One-time nudge shown shortly after the dashboard mounts, offering to set up the local
 * lock-screen PIN. Skippable and revisitable later from Settings (`PinSettings`) - this is a
 * suggestion, not a gate.
 */
const PinSetupPrompt: React.FC = () => {
    const [open, setOpen] = useState(false)
    const [pin, setPin] = useState('')
    const [confirmPin, setConfirmPin] = useState('')
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (!isLocalPinEnabled()) return
        if (hasPinConfigured()) return
        if (localStorage.getItem(PROMPT_SEEN_KEY)) return

        const timer = setTimeout(() => setOpen(true), OPEN_DELAY_MS)
        return () => clearTimeout(timer)
    }, [])

    const dismiss = () => {
        localStorage.setItem(PROMPT_SEEN_KEY, '1')
        setOpen(false)
    }

    const handleSetup = async () => {
        if (pin.length < MIN_PIN_LENGTH) {
            toast.error(`PIN must be at least ${MIN_PIN_LENGTH} digits`)
            return
        }
        if (pin !== confirmPin) {
            toast.error('PINs do not match')
            return
        }

        setSaving(true)
        try {
            await setupPin(pin)
            toast.success('PIN set up - your offline data is now locked behind it')
            dismiss()
        } catch (error) {
            toast.error(getApiErrorMessage(error))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal open={open} onClose={dismiss} title="Secure your offline data" size="sm">
            <div className="space-y-4">
                <p className="text-sm text-text-muted">
                    {BRAND.name} can work fully offline. Set up a PIN so your financial data stays
                    protected when this device isn&apos;t connected.
                </p>
                <label className="block text-sm text-text-secondary">
                    PIN
                    <input
                        type="password"
                        inputMode="numeric"
                        value={pin}
                        onChange={(event) => setPin(event.target.value)}
                        className="mt-2 w-full rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-accent/40 focus:outline-none"
                    />
                </label>
                <label className="block text-sm text-text-secondary">
                    Confirm PIN
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
                        onClick={() => void handleSetup()}
                        disabled={saving}
                        className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                        Set up PIN
                    </button>
                    <button
                        type="button"
                        onClick={dismiss}
                        className="rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-muted"
                    >
                        Skip for now
                    </button>
                </div>
            </div>
        </Modal>
    )
}

export default PinSetupPrompt
