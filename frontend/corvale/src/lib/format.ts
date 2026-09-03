import { DEFAULT_CURRENCY } from './currencies'
import { DEFAULT_DATE_FORMAT, type DateFormat } from './userPreferences'
import { tableInvalidationBus } from './tableInvalidationBus'

/**
 * Pseudo-table key on `tableInvalidationBus` (see `db/invalidation/tableInvalidationBus.ts`)
 * for preferred-currency / date-format / exchange-rate changes. Replaces the
 * `window` CustomEvent bus this module used to dispatch (Sprint 13.9) - both
 * `useAsyncData` and `useLocalQuery` subscribe to it the same way they
 * subscribe to any real table, so every data-fetching hook gets preference
 * refresh behavior for free regardless of which store it reads from.
 */
export const PREFS_CHANGED_TABLE = '_prefs'

let activePreferredCurrency: string = DEFAULT_CURRENCY
let activeDateFormat: DateFormat = DEFAULT_DATE_FORMAT

export const setPreferredCurrency = (currency: string): void => {
    if (currency === activePreferredCurrency) return
    activePreferredCurrency = currency
    tableInvalidationBus.publish(PREFS_CHANGED_TABLE)
}

export const resetPreferredCurrency = (): void => {
    activePreferredCurrency = DEFAULT_CURRENCY
}

export const getPreferredCurrency = (): string => activePreferredCurrency

export const setDateFormat = (format: DateFormat): void => {
    if (format === activeDateFormat) return
    activeDateFormat = format
    tableInvalidationBus.publish(PREFS_CHANGED_TABLE)
}

export const resetDateFormat = (): void => {
    activeDateFormat = DEFAULT_DATE_FORMAT
}

export const getDateFormat = (): DateFormat => activeDateFormat

/** Notifies data consumers (e.g. accounts, dashboard) that saved exchange rates changed, so converted balances refresh without a page reload. */
export const notifyExchangeRatesChanged = (): void => {
    tableInvalidationBus.publish(PREFS_CHANGED_TABLE)
}

const getUtcDateParts = (date: string | Date) => {
    const value = typeof date === 'string' ? new Date(date) : date
    return {
        day: String(value.getUTCDate()).padStart(2, '0'),
        month: String(value.getUTCMonth() + 1).padStart(2, '0'),
        year: String(value.getUTCFullYear()),
        shortYear: String(value.getUTCFullYear()).slice(-2),
    }
}

export const formatDisplayDate = (date: string | Date, format: DateFormat = activeDateFormat): string => {
    const { day, month, shortYear } = getUtcDateParts(date)

    switch (format) {
        case 'dd/mm/yy':
            return `${day}/${month}/${shortYear}`
        case 'yy/mm/dd':
            return `${shortYear}/${month}/${day}`
        case 'mm/dd/yy':
        default:
            return `${month}/${day}/${shortYear}`
    }
}

export const formatDisplayDateTime = (date: string | Date, format: DateFormat = activeDateFormat): string => {
    const value = typeof date === 'string' ? new Date(date) : date
    const time = value.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    })

    return `${formatDisplayDate(value, format)} ${time}`
}

export const formatCurrency = (amount: number, currency: string = activePreferredCurrency): string =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)

const currencySymbolCache = new Map<string, string>()

/** Short symbol (e.g. "$", "€", "₹") for a currency code, used in compact/abbreviated displays. */
export const getCurrencySymbol = (currency: string = activePreferredCurrency): string => {
    const cached = currencySymbolCache.get(currency)
    if (cached) return cached

    const symbol =
        new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
            .formatToParts(0)
            .find((part) => part.type === 'currency')?.value ?? currency

    currencySymbolCache.set(currency, symbol)
    return symbol
}

/** ISO yyyy-mm-dd for HTML date inputs - not affected by display preference. */
export const toDateInputValue = (date: string | Date): string => {
    const d = typeof date === 'string' ? new Date(date) : date
    return d.toISOString().split('T')[0]
}

export const formatBudgetPeriod = (
    periodStart: string,
    periodEnd: string,
    periodType: 'monthly' | 'custom'
): string => {
    if (periodType === 'monthly') {
        const start = new Date(periodStart)
        return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    }
    return `${formatDisplayDate(periodStart)} – ${formatDisplayDate(periodEnd)}`
}

export const getCurrentMonthYear = (): { year: number; month: number } => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

export const formatGoalTargetDate = (targetDate: string | null | undefined): string => {
    if (!targetDate) return 'No target date'
    return formatDisplayDate(targetDate)
}

export const formatContributionDate = (date: string): string => formatDisplayDate(date)

export const formatRelativeTime = (date: string): string => {
    const value = new Date(date).getTime()
    const diffMs = Date.now() - value
    const diffMinutes = Math.floor(diffMs / 60000)

    if (diffMinutes < 1) return 'Just now'
    if (diffMinutes < 60) return `${diffMinutes}m ago`

    const diffHours = Math.floor(diffMinutes / 60)
    if (diffHours < 24) return `${diffHours}h ago`

    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays}d ago`

    return formatDisplayDate(date)
}
