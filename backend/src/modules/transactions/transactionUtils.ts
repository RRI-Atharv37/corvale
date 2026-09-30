import { PipelineStage, Types } from 'mongoose'

import { IAccount, Account } from '@modules/accounts'
import { refreshAccountBalances } from '@modules/accounts/accountBalance'
import { ICategory, Category } from '@modules/categories'
import { Receipt } from '@modules/receipts'
import Transaction, { ITransaction, TransactionType, TransferRole } from './transaction.model'
import { User } from '@modules/users'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { buildScopedListFilter } from '@core/access/workspace'
import { fromMinorUnits, parseAmountToMinorUnits, toMinorUnits } from '@core/money/moneyUtils'
import { WorkspaceRole } from '@modules/workspaces'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'
import { buildCsvRow } from '@core/http/csv'
import { validateOwnership } from '@core/access/ownership'
import { validateRequiredFields } from '@core/http/validation'
import { buildSearchRegex } from '@core/query/searchRegex'
import { toObjectId } from '@core/db/objectId'
import { isMasterCategory, ensureMasterCategoriesSeeded } from "@modules/categories/categorySeed";
import { serializeReceipt, SerializedReceipt } from "@modules/receipts/receiptUtils";
import { assertWorkspaceMembership, validateResourceAccess } from "@modules/workspaces/access";
import { isInboundTransferLeg } from '@shared/transferDirection'

export interface SplitInput {
    /** Client-supplied child id (BUG-34 follow-up, sync-push splits only) - resolved the same way
     * every other sync create honors a client id. Absent on a REST-originated split. */
    _id?: unknown
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
    transferRole?: TransferRole | null
    splitTransactionId?: Types.ObjectId | null
    hasSplitChildren?: boolean
    recurringPaymentId?: Types.ObjectId | null
    receiptIds?: Types.ObjectId[]
    createdAt: Date
    updatedAt: Date
    transferDirection?: 'out' | 'in'
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

export const enrichTransactionsForWorkspace = async <T extends SerializedTransaction>(
    workspaceId: string | null,
    transactions: T[]
): Promise<T[]> => {
    if (!workspaceId) {
        return transactions
    }

    return attachUserFullNamesToTransactions(transactions) as Promise<T[]>
}

export const enrichTransactionForWorkspace = async <T extends SerializedTransaction>(
    workspaceId: string | null | undefined,
    transaction: T
): Promise<T> => {
    if (!workspaceId) {
        return transaction
    }

    const [enriched] = await attachUserFullNamesToTransactions([transaction])
    return enriched as T
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

export { getBalanceDeltaMajor, getTransferInDeltaMajor, getTransferOutDeltaMajor } from '@shared/money'

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
            _id: split._id,
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

/**
 * BUG-54: follow-up queries on a record that already passed `validateResourceAccess` are scoped
 * the way the record is - by workspace for a workspace record, by owner for a personal one - never
 * by the caller, who may be a co-member rather than the author.
 */
export const buildRecordScopeFilter = (
    record: Pick<ITransaction, 'userId' | 'workspaceId'>
): Record<string, unknown> =>
    buildScopedListFilter(record.userId.toString(), record.workspaceId?.toString() ?? null)

export const fetchSplitChildren = async (
    parent: Pick<ITransaction, '_id' | 'userId' | 'workspaceId'>
): Promise<ITransaction[]> => {
    return Transaction.find({
        ...buildRecordScopeFilter(parent),
        splitTransactionId: parent._id,
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
        fetchSplitChildren(transaction),
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

/**
 * Each transfer leg stores its own `transferRole`, which decides its direction. A leg from before
 * the field existed (not yet backfilled by `migrate:transfer-roles`) is resolved against its pair by
 * creation order instead (see `@shared/transferDirection`). Pairs are found within `transactions`
 * itself first (the common case - both legs land on the same list page), then one `_id: { $in }`
 * lookup covers the rest (RLS's documented allowed shape for "load rows the caller already holds ids
 * for"). A legacy leg whose pair can't be resolved (e.g. deleted) is left without a direction -
 * callers fall back to a neutral, non-directional display for it.
 */
export const attachTransferDirections = async <T extends SerializedTransaction>(
    transactions: T[]
): Promise<T[]> => {
    const legs = transactions.filter((tx) => tx.type === 'transfer' && tx.transferPairId)
    if (legs.length === 0) {
        return transactions
    }

    const stampById = new Map<string, { createdAt: Date; transferRole?: TransferRole | null }>(
        transactions.map((tx) => [
            tx._id.toString(),
            { createdAt: tx.createdAt, transferRole: tx.transferRole },
        ])
    )

    const missingIds = [
        ...new Set(
            legs
                .filter((tx) => !tx.transferRole)
                .map((tx) => tx.transferPairId!.toString())
                .filter((pairId) => !stampById.has(pairId))
        ),
    ]

    if (missingIds.length > 0) {
        const pairs = await Transaction.find({ _id: { $in: missingIds } }).select(
            'createdAt transferRole'
        )
        for (const pair of pairs) {
            stampById.set(pair._id.toString(), {
                createdAt: pair.createdAt,
                transferRole: pair.transferRole,
            })
        }
    }

    return transactions.map((tx) => {
        if (tx.type !== 'transfer' || !tx.transferPairId) {
            return tx
        }
        const pair = stampById.get(tx.transferPairId.toString())
        if (!tx.transferRole && !pair) {
            return tx
        }
        const isInbound = isInboundTransferLeg(
            { id: tx._id.toString(), createdAt: tx.createdAt, transferRole: tx.transferRole },
            {
                id: tx.transferPairId.toString(),
                createdAt: pair?.createdAt ?? tx.createdAt,
                transferRole: pair?.transferRole,
            }
        )
        return { ...tx, transferDirection: isInbound ? 'in' : 'out' }
    })
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

/**
 * SEC-58: the category join used only so `sortBy=category` can order by category name. The
 * sub-pipeline is scoped to the caller's own categories plus the shared masters and projects
 * `name` alone, so a co-member's personal category cannot leak through the joined document.
 * Callers must also drop `category` from the response with a trailing `{ $project: { category: 0 } }`
 * (it is not part of the transaction response contract - the non-sorted path returns only
 * `categoryId`) and set `.option({ [RLS_ALLOW_LOOKUP]: true })` so the RLS guard admits the join.
 */
export const buildCategorySortLookupStages = (userId: string): PipelineStage[] => [
    {
        $lookup: {
            from: 'categories',
            let: { categoryId: '$categoryId' },
            pipeline: [
                {
                    $match: {
                        $expr: { $eq: ['$_id', '$$categoryId'] },
                        userId: { $in: [null, new Types.ObjectId(userId)] },
                    },
                },
                { $project: { name: 1 } },
            ],
            as: 'category',
        },
    },
    { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
]

export const STRIP_CATEGORY_SORT_JOIN: PipelineStage = { $project: { category: 0 } }

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

export { escapeCsvValue, buildCsvRow } from '@core/http/csv'

export const buildCsvString = (rows: string[][]): string => {
    return rows.map(buildCsvRow).join('\n')
}

// SEC-59: the duplicate is attributed to the caller, not the original author. In a shared
// workspace an editor can duplicate a row a co-member created; stamping `transaction.userId`
// would forge that member's authorship on the new row. `workspaceId` still comes from the
// source so the copy lands in the same (personal or workspace) scope.
export const duplicateTransactionFields = (
    transaction: ITransaction,
    callerUserId: string | Types.ObjectId
) => ({
    userId: callerUserId,
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

        const transactionIsInbound = isInboundTransferLeg(
            {
                id: transaction._id.toString(),
                createdAt: transaction.createdAt,
                transferRole: transaction.transferRole,
            },
            { id: pair._id.toString(), createdAt: pair.createdAt, transferRole: pair.transferRole }
        )
        const outbound = transactionIsInbound ? pair : transaction
        const inbound = outbound._id.equals(transaction._id) ? pair : transaction

        const fromAccount = await validateAccountForTransaction(
            outbound.accountId.toString(),
            userId
        )
        const toAccount = await validateAccountForTransaction(
            inbound.accountId.toString(),
            userId
        )

        const deletedAt = new Date()
        await Transaction.updateMany(
            { _id: { $in: [outbound._id, inbound._id] }, ...buildRecordScopeFilter(transaction) },
            { deletedAt }
        )
        await refreshAccountBalances([fromAccount._id, toAccount._id])
        return
    }

    const splitChildren = await fetchSplitChildren(transaction)
    const account = await validateAccountForTransaction(
        transaction.accountId.toString(),
        userId
    )

    const deletedAt = new Date()

    if (splitChildren.length > 0) {
        await Transaction.updateMany(
            {
                _id: { $in: splitChildren.map((child) => child._id) },
                ...buildRecordScopeFilter(transaction),
            },
            { deletedAt }
        )
    }

    await Transaction.updateMany({ _id: transaction._id }, { deletedAt })
    await refreshAccountBalances([account._id])
}

export { Transaction, toMinorUnits, fromMinorUnits }
export { getUserId } from '@core/auth/requestUser'
export { handleResponses } from '@core/http/response'
export { validateOwnership } from '@core/access/ownership'
export { validateRequiredFields } from '@core/http/validation'
export { buildSearchRegex } from '@core/query/searchRegex'
export { toObjectId } from '@core/db/objectId'
