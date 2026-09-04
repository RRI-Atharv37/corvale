import { Types } from 'mongoose'

import { CustomError } from '@core/errors/customError'
import { mapWithConcurrency } from '@core/db/concurrency'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import {
    deleteTransactionForUser,
    isSplitChild,
    isTransferLeg,
    Transaction,
    validateCategoryForTransaction,
} from './transactionUtils'
import { ITransaction } from './transaction.model'
import { validateResourceAccess } from '@modules/workspaces/access'

const BULK_VALIDATION_CONCURRENCY = 20

/**
 * `validateResourceAccess` reports "exists but isn't yours" as 403 (correct for the singular
 * endpoints). Bulk delete must not: SEC-14 flagged the distinction as a cross-tenant existence
 * oracle, so this collapses both outcomes into the same 404 before anything is deleted.
 */
const resolveTransactionForBulkDelete = async (
    transactionId: string,
    userId: string
): Promise<ITransaction> => {
    try {
        return await validateResourceAccess<ITransaction>(
            Transaction,
            transactionId,
            userId,
            ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND,
            'editor'
        )
    } catch (error) {
        if (error instanceof CustomError && error.statusCode === 403) {
            throw new CustomError(ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND, 404)
        }
        throw error
    }
}

export const bulkDeleteTransactions = async (userId: string, transactionIds: string[]) => {
    // Validate every id up front so a bogus or not-owned id anywhere in the batch fails the whole
    // request before any deletion happens (BUG-03) — no partial delete to roll back.
    const transactions = await mapWithConcurrency(
        transactionIds,
        BULK_VALIDATION_CONCURRENCY,
        (transactionId) => resolveTransactionForBulkDelete(transactionId, userId)
    )

    const processedTransferPairs = new Set<string>()
    let deletedCount = 0

    for (const transaction of transactions) {
        if (isTransferLeg(transaction) && transaction.transferPairId) {
            const pairKey = [transaction._id.toString(), transaction.transferPairId.toString()]
                .sort()
                .join(':')
            if (processedTransferPairs.has(pairKey)) {
                deletedCount += 1
                continue
            }
            processedTransferPairs.add(pairKey)
        }

        await deleteTransactionForUser(userId, transaction)
        deletedCount += 1
    }

    return {
        message: `${deletedCount} transaction${deletedCount === 1 ? '' : 's'} deleted`,
        deletedCount,
    }
}

export const bulkUpdateTransactionCategory = async (
    userId: string,
    transactionIds: string[],
    categoryId: string
) => {
    await validateCategoryForTransaction(categoryId, userId)

    const transactions = await mapWithConcurrency(
        transactionIds,
        BULK_VALIDATION_CONCURRENCY,
        (transactionId) =>
            validateResourceAccess<ITransaction>(
                Transaction,
                transactionId,
                userId,
                ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND,
                'editor'
            )
    )

    for (const transaction of transactions) {
        if (transaction.type === 'transfer') {
            throw new CustomError(ERROR_MESSAGES.TRANSACTION.BULK_CATEGORY_TRANSFER, 400)
        }
        if (isSplitChild(transaction)) {
            throw new CustomError(ERROR_MESSAGES.TRANSACTION.SPLIT_NOT_EDITABLE, 400)
        }
    }

    const workspaceId = transactions[0]?.workspaceId ?? null
    const hasMixedWorkspaceScope = transactions.some(
        (transaction) =>
            (transaction.workspaceId?.toString() ?? null) !== (workspaceId?.toString() ?? null)
    )
    if (hasMixedWorkspaceScope) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.BULK_EMPTY, 400)
    }

    const updateFilter: Record<string, unknown> = {
        _id: { $in: transactions.map((transaction) => transaction._id) },
    }
    if (workspaceId) {
        updateFilter.workspaceId = workspaceId
    } else {
        updateFilter.userId = new Types.ObjectId(userId)
        updateFilter.workspaceId = null
    }

    await Transaction.updateMany(updateFilter, { $set: { categoryId } })

    return {
        message: `${transactions.length} transaction${transactions.length === 1 ? '' : 's'} updated`,
        updatedCount: transactions.length,
    }
}
