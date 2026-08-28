import { AccountType, TransactionType } from './types'

/** Round a major-unit float to 2 decimal places, avoiding classic FP drift (0.1 + 0.2). */
export const roundMoney = (amount: number): number =>
    Math.round((amount + Number.EPSILON) * 100) / 100

/** Convert a major-unit decimal amount (e.g. 10.50) to integer minor units (1050). */
export const toMinorUnits = (amount: number): number => {
    if (!Number.isFinite(amount)) {
        throw new Error('Invalid amount')
    }
    return Math.round((amount + Number.EPSILON) * 100)
}

/** Convert integer minor units back to a major-unit decimal. */
export const fromMinorUnits = (minorUnits: number): number => {
    return Math.round(minorUnits) / 100
}

/** Parse and validate a client-supplied amount, returning minor units. */
export const parseAmountToMinorUnits = (value: unknown): number => {
    const amount = Number(value)
    if (isNaN(amount) || amount < 0) {
        throw new Error('Invalid amount')
    }
    return toMinorUnits(amount)
}

/**
 * Signed major-unit balance delta a transaction applies to an account.
 * Credit accounts invert the usual income/expense sign (an expense raises
 * what you owe; a payment/income lowers it), and transfer legs mirror that
 * same inversion since a transfer behaves like income to the receiving leg.
 */
export const getBalanceDeltaMajor = (
    type: TransactionType,
    amountMinor: number,
    accountType: AccountType
): number => {
    const amountMajor = fromMinorUnits(amountMinor)

    if (type === 'transfer') {
        if (accountType === 'credit') {
            return amountMajor
        }
        return -amountMajor
    }

    if (accountType === 'credit') {
        return type === 'expense' ? amountMajor : -amountMajor
    }

    return type === 'income' ? amountMajor : -amountMajor
}

export const getTransferInDeltaMajor = (amountMinor: number, accountType: AccountType): number =>
    getBalanceDeltaMajor('income', amountMinor, accountType)

export const getTransferOutDeltaMajor = (amountMinor: number, accountType: AccountType): number =>
    getBalanceDeltaMajor('transfer', amountMinor, accountType)

/**
 * Same sign logic as getBalanceDeltaMajor, but for an account balance that is
 * itself stored in minor units (Sprint C5) — integer math throughout, no
 * fromMinorUnits round-trip, so no rounding drift on repeated application.
 */
export const getBalanceDeltaMinor = (
    type: TransactionType,
    amountMinor: number,
    accountType: AccountType
): number => {
    if (type === 'transfer') {
        return accountType === 'credit' ? amountMinor : -amountMinor
    }

    if (accountType === 'credit') {
        return type === 'expense' ? amountMinor : -amountMinor
    }

    return type === 'income' ? amountMinor : -amountMinor
}

export const getTransferInDeltaMinor = (amountMinor: number, accountType: AccountType): number =>
    getBalanceDeltaMinor('income', amountMinor, accountType)

export const getTransferOutDeltaMinor = (amountMinor: number, accountType: AccountType): number =>
    getBalanceDeltaMinor('transfer', amountMinor, accountType)

export interface SplitInput {
    categoryId: string
    amount: unknown
}

export interface NormalizedSplit {
    categoryId: string
    amount: number
}

/** Normalizes split lines to minor units and asserts they sum to the parent amount. */
export const validateSplitInputs = (
    splits: SplitInput[],
    parentAmountMinor: number
): NormalizedSplit[] => {
    if (splits.length < 2) {
        throw new Error('A split transaction requires at least 2 lines')
    }

    const normalized = splits.map((split, index) => {
        if (!split.categoryId) {
            throw new Error(`Split line ${index + 1} is missing a category`)
        }

        return {
            categoryId: split.categoryId,
            amount: parseAmountToMinorUnits(split.amount),
        }
    })

    const splitTotal = normalized.reduce((sum, split) => sum + split.amount, 0)
    if (splitTotal !== parentAmountMinor) {
        throw new Error('Split amounts must sum to the parent transaction amount')
    }

    return normalized
}
