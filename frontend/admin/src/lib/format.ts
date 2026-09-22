const DAY_MS = 24 * 60 * 60 * 1000
const DASH = '-'

type DateInput = string | Date | null | undefined

const toDate = (value: DateInput): Date | null => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Every date in the admin app is UTC, and says so where it carries a time. */
export const formatDate = (value: DateInput): string => toDate(value)?.toISOString().slice(0, 10) ?? DASH

export const formatDateTime = (value: DateInput): string => {
  const date = toDate(value)
  return date ? `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC` : DASH
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`

  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${UNITS[unit]}`
}

export const formatLimit = (limit: number | null, format: (value: number) => string = String): string =>
  limit === null ? 'Unlimited' : format(limit)

export const relativeDays = (value: DateInput, now: Date = new Date()): string => {
  const date = toDate(value)
  if (!date) return DASH

  const days = Math.trunc((date.getTime() - now.getTime()) / DAY_MS)
  if (days === 0) return 'today'

  const count = Math.abs(days)
  const unit = count === 1 ? 'day' : 'days'
  return days > 0 ? `in ${count} ${unit}` : `${count} ${unit} ago`
}

export const groupSecret = (secret: string): string => secret.replace(/(.{4})(?=.)/g, '$1 ')

const EMAIL_IN_TEXT = /[^\s@]+@[^\s@]+\.[^\s@]+/

export const containsEmail = (text: string): boolean => EMAIL_IN_TEXT.test(text)

export const humanize = (value: string | null | undefined): string => (value ? value.replace(/[._]/g, ' ') : DASH)

/** MRR/LTV figures carry no currency of their own - a single reporting currency's minor units (D13). */
export const formatMinor = (minor: number | null | undefined): string => (minor === null || minor === undefined ? DASH : (minor / 100).toFixed(2))

export const formatSignedMinor = (minor: number): string => `${minor > 0 ? '+' : ''}${formatMinor(minor)}`

export const formatPercent = (ratio: number | null | undefined, digits = 1): string => (ratio === null || ratio === undefined ? DASH : `${(ratio * 100).toFixed(digits)}%`)
