import { Types } from 'mongoose'
import Account from '../models/Account'
import Budget from '../models/Budget'
import RecurringRule from '../models/RecurringRule'
import SavingsGoal from '../models/SavingsGoal'
import Transaction from '../models/Transaction'
import { CustomError } from './customError'

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

export const parseOptionalSupportedCurrency = (
    value: unknown,
    fallback: SupportedCurrency = DEFAULT_CURRENCY
): SupportedCurrency => {
    if (value === undefined || value === null || value === '') {
        return fallback
    }
    return parseSupportedCurrency(value)
}

/** Updates stored currency on all user-owned financial records (no conversion). */
export const syncUserCurrencyData = async (
    userId: Types.ObjectId,
    currency: SupportedCurrency
): Promise<void> => {
    const filter = { userId }
    const update = { $set: { currency } }

    await Promise.all([
        Account.updateMany(filter, update),
        Transaction.updateMany(filter, update),
        Budget.updateMany(filter, update),
        SavingsGoal.updateMany(filter, update),
        RecurringRule.updateMany(filter, update),
    ])
}
