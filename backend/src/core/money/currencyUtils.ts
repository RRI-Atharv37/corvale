import { CustomError } from '../errors/customError'

export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'KRW', 'INR'] as const
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]

export const DEFAULT_CURRENCY: SupportedCurrency = 'USD'

/** Accept WON as a user-facing alias for KRW. */
const CURRENCY_ALIASES: Record<string, SupportedCurrency> = {
    WON: 'KRW',
}

export const normalizeCurrencyCode = (value: string): string => {
    const upper = value.trim().toUpperCase()
    return CURRENCY_ALIASES[upper] ?? upper
}

export const isSupportedCurrency = (value: string): value is SupportedCurrency => {
    return SUPPORTED_CURRENCIES.includes(value as SupportedCurrency)
}

export const parseSupportedCurrency = (value: unknown): SupportedCurrency => {
    if (typeof value !== 'string' || !value.trim()) {
        throw new CustomError(
            `Invalid currency. Must be one of: USD, EUR, WON, INR`,
            400
        )
    }

    const normalized = normalizeCurrencyCode(value)
    if (!isSupportedCurrency(normalized)) {
        throw new CustomError(
            `Invalid currency. Must be one of: USD, EUR, WON, INR`,
            400
        )
    }

    return normalized
}

/** Formats a major-unit amount for display in generated text (e.g. notifications). Mirrors the frontend `formatCurrency` in `utils/format.ts`. */
export const formatCurrencyAmount = (
    amountMajor: number,
    currency: string = DEFAULT_CURRENCY
): string => {
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountMajor)
    } catch {
        return `${currency} ${amountMajor.toFixed(2)}`
    }
}

export const parseOptionalSupportedCurrency = (
    value: unknown,
    fallback: SupportedCurrency = DEFAULT_CURRENCY
): SupportedCurrency => {
    if (value === undefined || value === null || value === '') {
        return fallback
    }
    return parseSupportedCurrency(value)
}
