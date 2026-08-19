import { CustomError } from './customError'
import { convertAmount as sharedConvertAmount } from '../../shared/src/timezone'

const PAIR_PATTERN = /^[A-Z]{3}_[A-Z]{3}$/

/** Normalizes a currency pair like 'EUR/USD' or 'eur_usd' into the storage key 'EUR_USD'. */
export const normalizePairKey = (pair: unknown): string => {
    if (typeof pair !== 'string' || !pair.trim()) {
        throw new CustomError('Currency pair is required', 400)
    }

    const key = pair.trim().toUpperCase().replace('/', '_')
    if (!PAIR_PATTERN.test(key)) {
        throw new CustomError('Currency pair must be in the format XXX/YYY', 400)
    }

    return key
}

export const parsePositiveRate = (value: unknown): number => {
    const rate = Number(value)
    if (isNaN(rate) || rate <= 0) {
        throw new CustomError('Exchange rate must be a positive number', 400)
    }
    return rate
}

export interface ConversionResult {
    convertedAmount: number
    rateApplied: number
    /** False when no direct or inverse rate was configured and the 1:1 fallback was used. */
    rateConfigured: boolean
}

/**
 * Converts an amount between currencies using the user's rate map (keyed 'FROM_TO').
 * Falls back to the inverse pair if present, then to a 1:1 rate when no rate is configured
 * so multi-currency totals never throw for a missing configuration. Callers that display
 * the conversion to the user should check `rateConfigured` before showing it, since the
 * 1:1 fallback is not a real conversion.
 */
export const convertAmount = (
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    rates: Record<string, number>
): ConversionResult => {
    const convertedAmount = sharedConvertAmount(amount, fromCurrency, toCurrency, rates)

    if (fromCurrency === toCurrency) {
        return { convertedAmount, rateApplied: 1, rateConfigured: true }
    }

    const directKey = `${fromCurrency}_${toCurrency}`
    if (typeof rates[directKey] === 'number') {
        return { convertedAmount, rateApplied: rates[directKey], rateConfigured: true }
    }

    const reverseKey = `${toCurrency}_${fromCurrency}`
    if (typeof rates[reverseKey] === 'number' && rates[reverseKey] !== 0) {
        return { convertedAmount, rateApplied: 1 / rates[reverseKey], rateConfigured: true }
    }

    return { convertedAmount, rateApplied: 1, rateConfigured: false }
}
