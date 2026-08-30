import React, { useCallback, useState, useSyncExternalStore } from 'react'
import toast from 'react-hot-toast'
import { getLocalDbDamageReason, getLocalDbHealth, markLocalDbHealthy, subscribeLocalDbHealth } from './localDbHealth'
import { rebuildLocalDb } from './bootstrapLocalDb'
import { provisionLocalDb } from './provisionLocalDb'
import { hasAnyPinMaterial, purgeLocalPinKeys } from '../offline/pinStorage'

type Phase = 'idle' | 'rebuilding' | 'error'

/**
 * BUG-30: blocks the dashboard when `bootstrapLocalDb` could not open or migrate the local store,
 * instead of letting every local-first page render a bare "Failed to load local data". Explains
 * what happened, then - on an explicit action - destroys the unreadable store, recreates it, and
 * re-downloads everything from the user's account (`/sync/bootstrap`). The server is authoritative
 * for synced data, so the only loss is changes made offline that were never pushed.
 *
 * Mounted inside `ProtectedRoute`, so the user is always authenticated by the time it renders.
 */
const LocalDbRecoveryGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const health = useSyncExternalStore(subscribeLocalDbHealth, getLocalDbHealth, getLocalDbHealth)
  const [phase, setPhase] = useState<Phase>('idle')
  const [step, setStep] = useState('')

  const handleRebuild = useCallback(async () => {
    setPhase('rebuilding')
    try {
      const hadPin = hasAnyPinMaterial()

      setStep('Clearing the damaged local store…')
      await rebuildLocalDb()

      setStep('Downloading your data…')
      await provisionLocalDb()

      if (hadPin) {
        purgeLocalPinKeys()
      }

      markLocalDbHealthy()
      toast.success(
        hadPin
          ? 'Local data rebuilt from your account. The local PIN on this device was also removed.'
          : 'Local data rebuilt from your account.'
      )
    } catch (error) {
      console.error('Local data rebuild failed', error)
      setPhase('error')
    }
  }, [])

  if (health === 'ok') {
    return <>{children}</>
  }

  const damageReason = getLocalDbDamageReason()

  return (
    <div className="min-h-screen bg-page flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-border-subtle bg-elevated p-6 space-y-4">
        <div>
          <h1 className="font-display text-lg font-semibold text-text-primary">Rebuild local data</h1>
          <p className="text-sm text-text-muted mt-1">
            The copy of your data stored on this device couldn&apos;t be opened and needs to be rebuilt. Your data is
            safe — it&apos;s stored on your Corvale account. Rebuilding re-downloads it here.
          </p>
        </div>

        {phase === 'rebuilding' ? (
          <p className="text-sm text-text-secondary" role="status">
            {step}
          </p>
        ) : (
          <>
            <p className="text-xs text-text-muted">
              Any changes you made offline that haven&apos;t synced yet can&apos;t be recovered and will be lost.
            </p>

            {phase === 'error' && (
              <p className="text-sm text-destructive">
                The rebuild didn&apos;t finish. Check your connection and try again. If it keeps failing, reinstall
                the app or contact support.
              </p>
            )}

            <button
              type="button"
              onClick={() => void handleRebuild()}
              className="w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {phase === 'error' ? 'Try again' : 'Rebuild now'}
            </button>

            {damageReason && (
              <p className="text-[11px] text-text-muted/70 break-words">Details: {damageReason}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default LocalDbRecoveryGate
