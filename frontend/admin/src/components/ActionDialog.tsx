import { useId, useState, type FormEvent, type ReactNode } from 'react'

import { containsEmail } from '../lib/format'
import { Button, ErrorAlert, Field, inputClass } from './ui'

export const MIN_REASON = 10
export const MAX_REASON = 500

interface Props {
  title: string
  submitLabel: string
  description?: ReactNode
  variant?: 'primary' | 'danger'
  /** Extra fields shown above the reason. */
  children?: ReactNode
  canSubmit?: boolean
  onSubmit: (reason: string) => Promise<void>
  onCancel: () => void
}

/**
 * Every staff action asks for a reason that lands in the audit log. The reason is checked here so that a
 * customer's email address (or anything that looks like one) never even leaves the form.
 */
export const ActionDialog = ({ title, submitLabel, description, variant = 'primary', children, canSubmit = true, onSubmit, onCancel }: Props) => {
  const titleId = useId()
  const reasonId = useId()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const trimmed = reason.trim()
  const hasEmail = containsEmail(reason)
  const validReason = trimmed.length >= MIN_REASON && trimmed.length <= MAX_REASON && !hasEmail

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !validReason || !canSubmit) return

    setBusy(true)
    setError(null)
    try {
      await onSubmit(trimmed)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The action failed')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div>
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          {description ? <p className="mt-1 text-sm text-text-muted">{description}</p> : null}
        </div>

        {children}

        <Field
          label="Reason"
          htmlFor={reasonId}
          hint={`${MIN_REASON}-${MAX_REASON} characters. Do not include customer emails or other personal details.`}
        >
          <textarea id={reasonId} className={`${inputClass} min-h-20`} value={reason} maxLength={MAX_REASON + 50} onChange={(event) => setReason(event.target.value)} />
        </Field>
        {hasEmail ? <p className="text-xs text-danger">The reason contains an email address; remove it.</p> : null}

        <ErrorAlert message={error} />

        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant={variant} disabled={busy || !validReason || !canSubmit}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </div>
  )
}
