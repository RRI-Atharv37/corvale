export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'KRW', 'INR'] as const
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]

export const DEFAULT_CURRENCY: SupportedCurrency = 'USD'

/** Display label in UI (KRW shown as WON per product convention). */
export const CURRENCY_LABELS: Record<SupportedCurrency, string> = {
    USD: 'USD',
    EUR: 'EUR',
    KRW: 'WON',
    INR: 'INR',
}

export const CURRENCY_OPTIONS = SUPPORTED_CURRENCIES.map((code) => ({
    value: code,
    label: CURRENCY_LABELS[code],
}))

export const formatCurrencyLabel = (code: string): string => {
    if (SUPPORTED_CURRENCIES.includes(code as SupportedCurrency)) {
        return CURRENCY_LABELS[code as SupportedCurrency]
    }
    return code
}

export const normalizeCurrencyInput = (value: string): SupportedCurrency | null => {
    const upper = value.trim().toUpperCase()
    if (upper === 'WON') return 'KRW'
    return SUPPORTED_CURRENCIES.includes(upper as SupportedCurrency)
        ? (upper as SupportedCurrency)
        : null
}
