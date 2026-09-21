import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'

import { Button, ErrorAlert, Field, Spinner, inputClass } from '../components/ui'
import { useAuth } from '../lib/auth'

const LoginPage = () => {
  const { status, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (status === 'authenticated') return <Navigate to="/" replace />
  if (status === 'loading') {
    return (
      <main className="mx-auto max-w-sm p-8">
        <Spinner label="Checking session" />
      </main>
    )
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (!email.trim() || !password || !code.trim()) {
      setError(useRecovery ? 'Enter your email, password and a recovery code.' : 'Enter your email, password and authenticator code.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      await login(
        useRecovery
          ? { email: email.trim(), password, recoveryCode: code.trim() }
          : { email: email.trim(), password, totpCode: code.trim() }
      )
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Sign-in failed')
      setCode('')
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Corvale Admin</h1>
        <p className="mt-1 text-sm text-text-muted">Internal tool. Sign in with your password and an authenticator code.</p>
      </div>

      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email">
          <input id="email" className={inputClass} type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <Field label="Password" htmlFor="password">
          <input id="password" className={inputClass} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        {useRecovery ? (
          <Field label="Recovery code" htmlFor="code" hint="Each recovery code works once.">
            <input id="code" className={inputClass} autoComplete="off" spellCheck={false} value={code} onChange={(event) => setCode(event.target.value)} />
          </Field>
        ) : (
          <Field label="Authenticator code" htmlFor="code">
            <input
              id="code"
              className={inputClass}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
        )}

        <ErrorAlert message={error} />

        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          {busy ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>

      <button
        type="button"
        className="text-left text-sm text-text-muted underline"
        onClick={() => {
          setUseRecovery((value) => !value)
          setCode('')
          setError(null)
        }}
      >
        {useRecovery ? 'Use an authenticator code instead' : 'Use a recovery code instead'}
      </button>
    </main>
  )
}

export default LoginPage
