import { Types } from 'mongoose'

import Account, { IAccount } from '../models/Account'
import Category, { ICategory } from '../models/Category'
import Receipt from '../models/Receipt'
import Transaction, { ITransaction, TransactionType } from '../models/Transaction'
import User from '../models/User'
import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'
import { fromMinorUnits, parseAmountToMinorUnits, toMinorUnits } from './moneyUtils'
import { isMasterCategory, ensureMasterCategoriesSeeded } from './categorySeed'
import { roundMoney } from './balanceUtils'
import {
    getBalanceDeltaMajor,
    getTransferInDeltaMajor,
    getTransferOutDeltaMajor,
} from '../../shared/src/money'
import { assertWorkspaceMembership, validateResourceAccess } from './workspaceUtils'
import { WorkspaceRole } from '../models/Workspace'
import { serializeReceipt, SerializedReceipt } from './receiptUtils'
import {
    getUserId,
    handleResponses,
    validateOwnership,
    validateRequiredFields,
    buildSearchRegex,
    toObjectId,
} from './sharedUtils'

export {
    getUserId,
    handleResponses,
    validateOwnership,
    validateRequiredFields,
    buildSearchRegex,
    toObjectId,
} from './sharedUtils'

export interface SplitInput {
    categoryId: string
    amount: unknown
}

export interface SerializedSplitLine extends SerializedTransaction {
    isSplitChild: true
}

export interface SerializedTransactionWithSplits extends SerializedTransaction {
    splits?: SerializedSplitLine[]
    transferPair?: SerializedTransaction
    receipts?: SerializedReceipt[]
}

export interface SerializedTransaction {
    _id: Types.ObjectId
    userId: Types.ObjectId
    userFullName?: string
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

export const attachUserFullNamesToTransactions = async (
    transactions: SerializedTransaction[]
): Promise<SerializedTransaction[]> => {
    if (transactions.length === 0) {
        return transactions
    }

    const userIds = [...new Set(transactions.map((transaction) => transaction.userId.toString()))]
    const users = await User.find({ _id: { $in: userIds } }).select('fullName')
    const nameById = new Map(users.map((user) => [user._id.toString(), user.fullName]))

    return transactions.map((transaction) => ({
        ...transaction,
        userFullName: nameById.get(transaction.userId.toString()),
    }))
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
    userId: string,
    minRole: WorkspaceRole = 'editor'
): Promise<IAccount> => {
    const account = await Account.findById(accountId)
    if (!account) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.ACCOUNT_NOT_FOUND, 404)
    }
    if (account.isArchived) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.ACCOUNT_ARCHIVED, 400)
    }

    if (account.workspaceId) {
        await assertWorkspaceMembership(account.workspaceId.toString(), userId, minRole)
        return account
    }

    if (account.userId.toString() !== userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 403)
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

export { getBalanceDeltaMajor, getTransferInDeltaMajor, getTransferOutDeltaMajor }

export const LISTABLE_TRANSACTION_FILTER = {
    splitTransactionId: null,
} as const

export const getOtherMasterCategoryId = async (): Promise<Types.ObjectId> => {
    await ensureMasterCategoriesSeeded()
    const category = await Category.findOne({ userId: null, name: 'Other' })
    if (!category) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.CATEGORY_NOT_FOUND, 500)
    }
    return category._id
}

export const validateSplitInputs = (splits: SplitInput[], parentAmountMinor: number): SplitInput[] => {
    if (splits.length < 2) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.SPLIT_MIN_COUNT, 400)
    }

    const normalized = splits.map((split, index) => {
        if (!split.categoryId) {
            throw new CustomError(`Split line ${index + 1} is missing a category`, 400)
        }

        return {
            categoryId: split.categoryId,
            amount: parseClientAmount(split.amount),
        }
    })

    const splitTotal = normalized.reduce((sum, split) => sum + split.amount, 0)
    if (splitTotal !== parentAmountMinor) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.SPLIT_SUM_MISMATCH, 400)
    }

    return normalized
}

export const applyTransferToAccounts = async (
    fromAccount: IAccount,
    toAccount: IAccount,
    amountMinor: number
): Promise<void> => {
    const fromDelta = getTransferOutDeltaMajor(amountMinor, fromAccount.type)
    const toDelta = getTransferInDeltaMajor(amountMinor, toAccount.type)

    fromAccount.currentBalance = roundMoney(fromAccount.currentBalance + fromDelta)
    toAccount.currentBalance = roundMoney(toAccount.currentBalance + toDelta)

    await fromAccount.save()
    await toAccount.save()
}

export const reverseTransferOnAccounts = async (
    fromAccount: IAccount,
    toAccount: IAccount,
    amountMinor: number
): Promise<void> => {
    const fromDelta = getTransferOutDeltaMajor(amountMinor, fromAccount.type)
    const toDelta = getTransferInDeltaMajor(amountMinor, toAccount.type)

    fromAccount.currentBalance = roundMoney(fromAccount.currentBalance - fromDelta)
    toAccount.currentBalance = roundMoney(toAccount.currentBalance - toDelta)

    await fromAccount.save()
    await toAccount.save()
}

export const fetchSplitChildren = async (
    parentId: Types.ObjectId | string,
    userId: string
): Promise<ITransaction[]> => {
    return Transaction.find({
        userId: new Types.ObjectId(userId),
        splitTransactionId: parentId,
    }).sort({ createdAt: 1 })
}

export const fetchReceiptsForTransaction = async (
    receiptIds: Types.ObjectId[] | undefined,
    userId: string
): Promise<SerializedReceipt[]> => {
    if (!receiptIds || receiptIds.length === 0) {
        return []
    }

    const receipts = await Receipt.find({
        _id: { $in: receiptIds },
        userId: new Types.ObjectId(userId),
    }).sort({ createdAt: 1 })

    return receipts.map(serializeReceipt)
}

export const serializeTransactionWithSplits = async (
    transaction: ITransaction,
    userId: string
): Promise<SerializedTransactionWithSplits> => {
    const serialized = serializeTransaction(transaction)

    if (transaction.splitTransactionId) {
        return serialized
    }

    const [children, receipts] = await Promise.all([
        fetchSplitChildren(transaction._id, userId),
        fetchReceiptsForTransaction(transaction.receiptIds, userId),
    ])

    const payload: SerializedTransactionWithSplits = { ...serialized }

    if (children.length > 0) {
        payload.splits = children.map((child) => ({
            ...serializeTransaction(child),
            isSplitChild: true as const,
        }))
    }

    if (receipts.length > 0) {
        payload.receipts = receipts
    }

    return payload
}

export const isSplitChild = (transaction: ITransaction): boolean =>
    transaction.splitTransactionId != null

export const isTransferLeg = (transaction: ITransaction): boolean =>
    transaction.type === 'transfer' && transaction.transferPairId != null

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

export const assertEditableTransaction = (transaction: ITransaction): void => {
    if (transaction.type === 'transfer') {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.TRANSFER_NOT_EDITABLE, 400)
    }
    if (transaction.splitTransactionId) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.SPLIT_NOT_EDITABLE, 400)
    }
}

export const deleteTransactionForUser = async (
    userId: string,
    transaction: ITransaction
): Promise<void> => {
    if (isSplitChild(transaction)) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.SPLIT_NOT_EDITABLE, 400)
    }

    if (isTransferLeg(transaction) && transaction.transferPairId) {
        const pair = await validateResourceAccess(
            Transaction,
            transaction.transferPairId.toString(),
            userId,
            ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND,
            'editor'
        )

        const outbound = transaction.createdAt <= pair.createdAt ? transaction : pair
        const inbound = outbound._id.equals(transaction._id) ? pair : transaction

        const fromAccount = await validateAccountForTransaction(
            outbound.accountId.toString(),
            userId
        )
        const toAccount = await validateAccountForTransaction(
            inbound.accountId.toString(),
            userId
        )

        await reverseTransferOnAccounts(fromAccount, toAccount, transaction.amount)
        await Transaction.deleteOne({ _id: outbound._id })
        await Transaction.deleteOne({ _id: inbound._id })
        return
    }

    const splitChildren = await fetchSplitChildren(transaction._id, userId)
    const account = await validateAccountForTransaction(
        transaction.accountId.toString(),
        userId
    )

    await reverseTransactionOnAccount(account, transaction.type, transaction.amount)

    if (splitChildren.length > 0) {
        await Transaction.deleteMany({
            _id: { $in: splitChildren.map((child) => child._id) },
            userId: new Types.ObjectId(userId),
        })
    }

    await Transaction.deleteOne({ _id: transaction._id })
}

export { Transaction, toMinorUnits, fromMinorUnits }
