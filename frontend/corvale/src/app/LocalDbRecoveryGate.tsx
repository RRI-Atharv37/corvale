import React, { useCallback, useState, useSyncExternalStore } from 'react'
import toast from 'react-hot-toast'
import { getLocalDbDamageReason, getLocalDbHealth, markLocalDbHealthy, subscribeLocalDbHealth } from '@platform/db/localDbHealth'
import { rebuildLocalDb, retryLocalDbOpen } from '@platform/db/bootstrapLocalDb'
import { provisionLocalDb } from '@platform/db/provisionLocalDb'
import { hasAnyPinMaterial, purgeLocalPinKeys } from '@platform/offline/pinStorage'
import { useUser } from './providers/useUser'

type Phase = 'idle' | 'rebuilding' | 'error'

/**
 * SEC-40: the desktop SQLCipher key lives in the OS credential store. A locked login keyring (or a
 * dismissed keychain-access prompt) makes `db_open` fail with this tag until it is unlocked - a
 * transient condition, so the gate offers a non-destructive retry instead of the rebuild-from-
 * server flow, which would discard unsynced offline changes.
 */
const isKeychainBlocked = (reason: string | null): boolean =>
  reason !== null && reason.includes('KEYCHAIN_UNAVAILABLE')

/**
 * BUG-30: blocks the dashboard when `bootstrapLocalDb` could not open or migrate the local store,
 * instead of letting every local-first page render a bare "Failed to load local data". Explains
 * what happened, then - on an explicit action - either retries the open (SEC-40 keychain case) or
 * destroys the unreadable store, recreates it, and re-downloads everything from the user's account
 * (`/sync/bootstrap`). The server is authoritative for synced data, so the only loss is changes
 * made offline that were never pushed.
 *
 * Mounted inside `ProtectedRoute`, so the user is always authenticated by the time it renders.
 */
const LocalDbRecoveryGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const health = useSyncExternalStore(subscribeLocalDbHealth, getLocalDbHealth, getLocalDbHealth)
  const { user } = useUser()
  const [phase, setPhase] = useState<Phase>('idle')
  const [step, setStep] = useState('')

  const damageReason = getLocalDbDamageReason()
  const keychainBlocked = isKeychainBlocked(damageReason)

  const handleRetryOpen = useCallback(async () => {
    setPhase('rebuilding')
    setStep('Reconnecting to secure key storage…')
    try {
      await retryLocalDbOpen()
      markLocalDbHealthy()
      toast.success('Local data unlocked.')
    } catch (error) {
      console.error('Local DB re-open failed', error)
      setPhase('error')
    }
  }, [])

  const handleRebuild = useCallback(async () => {
    setPhase('rebuilding')
    try {
      const hadPin = hasAnyPinMaterial()

      setStep('Clearing the damaged local store…')
      await rebuildLocalDb()

      setStep('Downloading your data…')
      await provisionLocalDb(user?._id)

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
  }, [user?._id])

  if (health === 'ok') {
    return <>{children}</>
  }

  const heading = keychainBlocked ? 'Unlock local data' : 'Rebuild local data'
  const onAction = keychainBlocked ? handleRetryOpen : handleRebuild

  return (
    <div className="min-h-screen bg-page flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-border-subtle bg-elevated p-6 space-y-4">
        <div>
          <h1 className="font-display text-lg font-semibold text-text-primary">{heading}</h1>
          {keychainBlocked ? (
            <p className="text-sm text-text-muted mt-1">
              Corvale couldn&apos;t reach your operating system&apos;s secure key storage, which holds the key for
              your local data. This usually means your login keyring is locked. Unlock it (or allow the access
              prompt) and try again — nothing on this device has been changed.
            </p>
          ) : (
            <p className="text-sm text-text-muted mt-1">
              The copy of your data stored on this device couldn&apos;t be opened and needs to be rebuilt. Your data
              is safe — it&apos;s stored on your Corvale account. Rebuilding re-downloads it here.
            </p>
          )}
        </div>

        {phase === 'rebuilding' ? (
          <p className="text-sm text-text-secondary" role="status">
            {step}
          </p>
        ) : (
          <>
            {!keychainBlocked && (
              <p className="text-xs text-text-muted">
                Any changes you made offline that haven&apos;t synced yet can&apos;t be recovered and will be lost.
              </p>
            )}

            {phase === 'error' && (
              <p className="text-sm text-destructive">
                {keychainBlocked
                  ? "Still couldn't open the local data. Make sure your system keyring is unlocked, then try again."
                  : "The rebuild didn't finish. Check your connection and try again. If it keeps failing, reinstall the app or contact support."}
              </p>
            )}

            <button
              type="button"
              onClick={() => void onAction()}
              className="w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {phase === 'error' ? 'Try again' : keychainBlocked ? 'Retry' : 'Rebuild now'}
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
