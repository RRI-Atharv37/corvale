import type { ButtonHTMLAttributes, ReactNode } from 'react'

const BUTTON_BASE =
  'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50'

const BUTTON_VARIANTS = {
  primary: 'bg-accent text-white hover:bg-accent-hover',
  secondary: 'border border-border bg-surface text-text hover:bg-surface-2',
  danger: 'bg-danger text-white hover:opacity-90',
} as const

export const Button = ({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON_VARIANTS }) => (
  <button type="button" className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`} {...props} />
)

const BADGE_TONES = {
  good: 'bg-good/15 text-good',
  warn: 'bg-warn/15 text-warn',
  bad: 'bg-danger/15 text-danger',
  neutral: 'bg-surface-2 text-text-muted',
} as const

export const Badge = ({ tone = 'neutral', children }: { tone?: keyof typeof BADGE_TONES; children: ReactNode }) => (
  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_TONES[tone]}`}>{children}</span>
)

export const ErrorAlert = ({ message }: { message: string | null | undefined }) =>
  message ? (
    <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      {message}
    </p>
  ) : null

export const Section = ({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) => {
  const id = `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <section aria-labelledby={id} className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id={id} className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export const Facts = ({ rows }: { rows: [string, ReactNode][] }) => (
  <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
    {rows.map(([label, value]) => (
      <div key={label} className="contents">
        <dt className="text-text-muted">{label}</dt>
        <dd className="break-all">{value}</dd>
      </div>
    ))}
  </dl>
)

export const inputClass =
  'w-full rounded-md border border-border bg-page px-3 py-1.5 text-sm text-text placeholder:text-text-quiet focus-visible:outline-2 focus-visible:outline-accent'

export const Field = ({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: ReactNode; children: ReactNode }) => (
  <div className="space-y-1">
    <label htmlFor={htmlFor} className="block text-sm font-medium">
      {label}
    </label>
    {children}
    {hint ? <p className="text-xs text-text-muted">{hint}</p> : null}
  </div>
)

export const Spinner = ({ label = 'Loading' }: { label?: string }) => (
  <p role="status" className="text-sm text-text-muted">
    {label}...
  </p>
)
