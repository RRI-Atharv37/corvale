/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { ApiError, STEP_UP_REQUIRED_MESSAGE, api } from '../lib/api'
import { Button, ErrorAlert, Field, inputClass } from './ui'

interface StepUpContextValue {
  /** Runs `action`; if the server wants a fresh authenticator code, asks for one and retries the action once. */
  run: <T>(action: () => Promise<T>) => Promise<T>
}

const StepUpContext = createContext<StepUpContextValue | null>(null)

interface Pending {
  resolve: () => void
  reject: (error: Error) => void
}

const needsStepUp = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 403 && error.message === STEP_UP_REQUIRED_MESSAGE

export const StepUpProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = useRef<Pending | null>(null)

  const requestCode = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        pending.current = { resolve, reject }
        setCode('')
        setError(null)
        setOpen(true)
      }),
    []
  )

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action()
      } catch (failure) {
        if (!needsStepUp(failure)) throw failure
        await requestCode()
        return action()
      }
    },
    [requestCode]
  )

  const close = () => {
    setOpen(false)
    setBusy(false)
    pending.current = null
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !code.trim()) return

    setBusy(true)
    setError(null)
    try {
      await api.stepUp(code.trim())
      pending.current?.resolve()
      close()
    } catch (failure) {
      setBusy(false)
      setError(failure instanceof Error ? failure.message : 'Could not confirm the code')
    }
  }

  const cancel = () => {
    pending.current?.reject(new ApiError('Confirmation cancelled', 0))
    close()
  }

  const value = useMemo(() => ({ run }), [run])

  return (
    <StepUpContext.Provider value={value}>
      {children}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="stepup-title"
            onSubmit={submit}
            className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-surface p-5 shadow-xl"
          >
            <div>
              <h2 id="stepup-title" className="text-base font-semibold">
                Confirm it is you
              </h2>
              <p className="mt-1 text-sm text-text-muted">This action needs a fresh code from your authenticator app. The code from your sign-in cannot be reused.</p>
            </div>
            <Field label="Authenticator code" htmlFor="stepup-code">
              <input
                id="stepup-code"
                className={inputClass}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </Field>
            <ErrorAlert message={error} />
            <div className="flex justify-end gap-2">
              <Button onClick={cancel}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={busy || code.trim().length === 0}>
                Confirm
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </StepUpContext.Provider>
  )
}

export const useStepUp = (): StepUpContextValue => {
  const value = useContext(StepUpContext)
  if (!value) throw new Error('useStepUp must be used inside StepUpProvider')
  return value
}
