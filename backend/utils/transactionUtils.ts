import { Types } from 'mongoose'

import Account, { AccountType, IAccount } from '../models/Account'
import Category, { ICategory } from '../models/Category'
import Transaction, { ITransaction, TransactionType } from '../models/Transaction'
import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'
import { fromMinorUnits, parseAmountToMinorUnits, toMinorUnits } from './moneyUtils'
import { isMasterCategory } from './categorySeed'
import { roundMoney } from './balanceUtils'

export {
    getUserId,
    handleResponses,
    validateOwnership,
    validateRequiredFields,
    buildSearchRegex,
    toObjectId,
} from './sharedUtils'

export interface SerializedTransaction {
    _id: Types.ObjectId
    userId: Types.ObjectId
    workspaceId?: Types.ObjectId | null
    accountId: Types.ObjectId
    categoryId: Types.ObjectId
    type: TransactionType
    status: string
    amount: number
    currency: string
    title: string
    description?: string
    date: Date
    source?: string
    paymentMethod?: string
    tags?: string[]
    transferPairId?: Types.ObjectId | null
    splitTransactionId?: Types.ObjectId | null
    recurringPaymentId?: Types.ObjectId | null
    receiptIds?: Types.ObjectId[]
    createdAt: Date
    updatedAt: Date
}

export const serializeTransactionPlain = (
    transaction: Record<string, unknown> & { amount: number }
): SerializedTransaction => {
    return {
        ...(transaction as unknown as SerializedTransaction),
        amount: fromMinorUnits(transaction.amount),
    }
}

export const serializeTransaction = (transaction: ITransaction): SerializedTransaction => {
    return serializeTransactionPlain(transaction.toObject())
}

export const serializeTransactions = (transactions: ITransaction[]): SerializedTransaction[] => {
    return transactions.map(serializeTransaction)
}

export const parseClientAmount = (value: unknown): number => {
    try {
        return parseAmountToMinorUnits(value)
    } catch {
        throw new CustomError('Invalid amount format', 400)
    }
}

export const validateAccountForTransaction = async (
    accountId: string,
    userId: string
): Promise<IAccount> => {
    const account = await Account.findById(accountId)
    if (!account) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.ACCOUNT_NOT_FOUND, 404)
    }
    if (account.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }
    if (account.isArchived) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.ACCOUNT_ARCHIVED, 400)
    }
    return account
}

export const validateCategoryForTransaction = async (
    categoryId: string,
    userId: string
): Promise<ICategory> => {
    const category = await Category.findById(categoryId)
    if (!category) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.CATEGORY_NOT_FOUND, 404)
    }
    if (category.isArchived) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.CATEGORY_ARCHIVED, 400)
    }

    if (isMasterCategory(category)) {
        return category
    }

    if (category.userId?.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
    }

    return category
}

const getBalanceDeltaMajor = (
    type: TransactionType,
    amountMinor: number,
    accountType: AccountType
): number => {
    const amountMajor = fromMinorUnits(amountMinor)

    if (accountType === 'credit') {
        return type === 'expense' ? amountMajor : -amountMajor
    }

    return type === 'income' ? amountMajor : -amountMajor
}

export const applyTransactionToAccount = async (
    account: IAccount,
    type: TransactionType,
    amountMinor: number
): Promise<void> => {
    const delta = getBalanceDeltaMajor(type, amountMinor, account.type)
    account.currentBalance = roundMoney(account.currentBalance + delta)
    await account.save()
}

export const reverseTransactionOnAccount = async (
    account: IAccount,
    type: TransactionType,
    amountMinor: number
): Promise<void> => {
    const delta = getBalanceDeltaMajor(type, amountMinor, account.type)
    account.currentBalance = roundMoney(account.currentBalance - delta)
    await account.save()
}

export const adjustAccountForTransactionChange = async (
    oldTransaction: ITransaction,
    newType: TransactionType,
    newAmountMinor: number,
    newAccountId: string
): Promise<void> => {
    const oldAccount = await Account.findById(oldTransaction.accountId)
    if (!oldAccount) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.ACCOUNT_NOT_FOUND, 404)
    }

    const newAccount =
        oldTransaction.accountId.toString() === newAccountId
            ? oldAccount
            : await Account.findById(newAccountId)

    if (!newAccount) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.ACCOUNT_NOT_FOUND, 404)
    }

    await reverseTransactionOnAccount(oldAccount, oldTransaction.type, oldTransaction.amount)

    if (newAccount._id.toString() !== oldAccount._id.toString()) {
        await applyTransactionToAccount(newAccount, newType, newAmountMinor)
    } else {
        await applyTransactionToAccount(oldAccount, newType, newAmountMinor)
    }
}

export const buildTransactionSort = (
    sortBy?: string,
    sortOrder?: string
): Record<string, 1 | -1> => {
    const direction: 1 | -1 = sortOrder === 'asc' ? 1 : -1

    switch (sortBy) {
        case 'amount':
            return { amount: direction }
        case 'category':
            return { 'category.name': direction, date: -1 }
        case 'date':
        default:
            return { date: direction }
    }
}

export const formatTransactionCsvRow = (transaction: SerializedTransaction, categoryName: string): string[] => {
    return [
        transaction.type,
        transaction.title,
        transaction.amount.toFixed(2),
        transaction.currency,
        categoryName,
        transaction.date.toISOString().split('T')[0],
        transaction.description || '',
        transaction.source || '',
        transaction.paymentMethod || '',
        transaction.tags?.join('; ') || '',
        transaction.status,
    ]
}

export const CSV_HEADERS = [
    'Type',
    'Title',
    'Amount',
    'Currency',
    'Category',
    'Date',
    'Description',
    'Source',
    'Payment Method',
    'Tags',
    'Status',
]

export const escapeCsvValue = (value: string): string => {
    if (/[",\n]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`
    }
    return value
}

export const buildCsvString = (rows: string[][]): string => {
    return rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n')
}

export const duplicateTransactionFields = (transaction: ITransaction) => ({
    userId: transaction.userId,
    workspaceId: transaction.workspaceId,
    accountId: transaction.accountId,
    categoryId: transaction.categoryId,
    type: transaction.type,
    status: transaction.status,
    amount: transaction.amount,
    currency: transaction.currency,
    title: transaction.title,
    description: transaction.description,
    date: new Date(),
    source: transaction.source,
    paymentMethod: transaction.paymentMethod,
    tags: transaction.tags,
})

export { Transaction, toMinorUnits, fromMinorUnits }
