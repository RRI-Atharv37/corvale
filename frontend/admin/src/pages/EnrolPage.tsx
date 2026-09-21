import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button, ErrorAlert, Field, Spinner, inputClass } from '../components/ui'
import { api } from '../lib/api'
import { groupSecret } from '../lib/format'
import type { EnrolStart } from '../lib/types'

const MIN_PASSWORD = 14

/** The single-use token arrives in the URL fragment (never sent to a server), and is removed from the address bar at once. */
const takeTokenFromUrl = (): string | null => {
  const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token')
  window.history.replaceState(null, '', window.location.pathname)
  return token && token.trim() !== '' ? token.trim() : null
}

const EnrolPage = () => {
  const navigate = useNavigate()
  const tokenRef = useRef<string | null | undefined>(undefined)
  const [start, setStart] = useState<EnrolStart | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)

  useEffect(() => {
    if (tokenRef.current === undefined) tokenRef.current = takeTokenFromUrl()
    const token = tokenRef.current

    if (!token) {
      setLoadError('This page needs the enrolment link you were given. Open the link again.')
      return
    }

    let active = true
    api.enrolStart(token).then(
      (result) => active && setStart(result),
      (failure: unknown) => active && setLoadError(failure instanceof Error ? failure.message : 'This link could not be used')
    )
    return () => {
      active = false
    }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !start || !tokenRef.current) return

    if (start.requiresPassword && password.length < MIN_PASSWORD) {
      setError(`Choose a password of at least ${MIN_PASSWORD} characters.`)
      return
    }
    if (!password || !code.trim()) {
      setError('Enter your password and the code from your authenticator app.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const result = await api.enrolComplete({ token: tokenRef.current, password, totpCode: code.trim() })
      setRecoveryCodes(result.recoveryCodes)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Enrolment failed')
      setBusy(false)
    }
  }

  if (recoveryCodes) {
    return (
      <main className="mx-auto max-w-md space-y-4 p-6">
        <h1 className="text-xl font-semibold">Save your recovery codes</h1>
        <p className="text-sm text-text-muted">
          Each code signs you in once if you lose your authenticator. They are shown only now. Store them somewhere safe, apart from your password.
        </p>
        <ul className="grid grid-cols-2 gap-2 rounded-md border border-border bg-surface p-3 font-mono text-sm">
          {recoveryCodes.map((recoveryCode) => (
            <li key={recoveryCode}>{recoveryCode}</li>
          ))}
        </ul>
        <Button variant="primary" onClick={() => navigate('/login', { replace: true })}>
          I have saved these codes
        </Button>
      </main>
    )
  }

  if (loadError) {
    return (
      <main className="mx-auto max-w-md p-6">
        <ErrorAlert message={loadError} />
      </main>
    )
  }
  if (!start) {
    return (
      <main className="mx-auto max-w-md p-6">
        <Spinner label="Checking your link" />
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-md space-y-5 p-6">
      <div>
        <h1 className="text-xl font-semibold">{start.requiresPassword ? 'Set up your admin account' : 'Re-enrol your authenticator'}</h1>
        <p className="mt-1 text-sm text-text-muted">
          <span className="font-medium text-text">{start.email}</span> ({start.role})
        </p>
      </div>

      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>
          Add this key to an authenticator app (enter it manually, time-based, 6 digits):
          <p className="mt-1 break-all rounded-md border border-border bg-surface p-2 font-mono text-xs">{groupSecret(start.secret)}</p>
        </li>
        <li>{start.requiresPassword ? 'Choose a password (14 characters or more).' : 'Enter your existing password to confirm it is you.'}</li>
        <li>Enter the 6-digit code your app shows now.</li>
      </ol>

      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label={start.requiresPassword ? 'New password' : 'Current password'} htmlFor="password">
          <input
            id="password"
            className={inputClass}
            type="password"
            autoComplete={start.requiresPassword ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field label="Authenticator code" htmlFor="code">
          <input id="code" className={inputClass} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} />
        </Field>
        <ErrorAlert message={error} />
        <Button type="submit" variant="primary" disabled={busy}>
          Finish setup
        </Button>
      </form>
    </main>
  )
}

export default EnrolPage
