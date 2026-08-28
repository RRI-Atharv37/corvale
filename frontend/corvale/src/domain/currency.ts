import type { LocalDb } from '../db/LocalDb'
import { getLocalUserPrefs } from '../db/localUserPrefs'
import { convertAmount as sharedConvertAmount } from '@shared/timezone'

export interface LocalConversionResult {
  convertedAmount: number
  rateApplied: number
  /** False when no direct or inverse rate was configured and the 1:1 fallback was used. */
  rateConfigured: boolean
}

/**
 * Local mirror of `backend/utils/exchangeRateUtils.convertAmount`: same
 * direct/inverse/1:1-fallback resolution built on top of the shared bare
 * `convertAmount`, but reading the rate map from the local cache instead of
 * a live `User` document.
 */
export const convertAmountWithRates = (
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rates: Record<string, number>
): LocalConversionResult => {
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

export const convertAmountLocal = async (
  db: LocalDb,
  amount: number,
  fromCurrency: string,
  toCurrency: string
): Promise<LocalConversionResult> => {
  const prefs = await getLocalUserPrefs(db)
  return convertAmountWithRates(amount, fromCurrency, toCurrency, prefs?.exchangeRates ?? {})
}
