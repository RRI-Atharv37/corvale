import asyncHandler from 'express-async-handler'
import { Response } from 'express'
import { Types } from 'mongoose'

import { AuthRequest } from '@http/middleware/authTypes'
import { CustomError } from '@core/errors/customError'
import { mapWithConcurrency } from '@core/db/concurrency'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import {
    deleteTransactionForUser,
    getUserId,
    handleResponses,
    isSplitChild,
    isTransferLeg,
    Transaction,
    validateCategoryForTransaction,
    validateRequiredFields,
} from './transactionUtils'
import { ITransaction } from './transaction.model'
import { validateResourceAccess } from '@modules/workspaces/access'

// SEC-61: bulk endpoints run one ownership-validating query per id. The array is
// caller-controlled, so it needs the same kind of ceiling the sync push has (`MAX_PUSH_OPS`),
// and the per-id queries are fanned out with bounded concurrency rather than one unbounded
// `Promise.all`.
const MAX_BULK_TRANSACTION_IDS = 500
const BULK_VALIDATION_CONCURRENCY = 20

const parseBulkTransactionIds = (transactionIds: unknown): string[] => {
    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.BULK_EMPTY, 400)
    }

    const uniqueIds = [...new Set(transactionIds.map((id) => String(id).trim()).filter(Boolean))]
    if (uniqueIds.length === 0) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.BULK_EMPTY, 400)
    }
    if (uniqueIds.length > MAX_BULK_TRANSACTION_IDS) {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION.BULK_TOO_MANY, 413)
    }

    return uniqueIds
}

/**
 * `validateResourceAccess` reports "exists but isn't yours" as 403 (correct for the singular
 * endpoints, which intentionally distinguish the two). Bulk delete must not: SEC-14 flagged the
 * distinction as a cross-tenant existence oracle, so this endpoint collapses both outcomes into
 * the same 404 before anything is deleted.
 */
const resolveTransactionForBulkDelete = async (
    transactionId: string,
    userId: string
): Promise<ITransaction> => {
    try {
        return await validateResourceAccess(
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

export const bulkDeleteTransactions = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const transactionIds = parseBulkTransactionIds(req.body.transactionIds)

    // Validate every id up front so a bogus or not-owned id anywhere in the batch fails the
    // whole request before any deletion happens (BUG-03) — no partial delete to roll back.
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

    handleResponses(res, 200, {
        message: `${deletedCount} transaction${deletedCount === 1 ? '' : 's'} deleted`,
        deletedCount,
    })
})

export const bulkUpdateTransactionCategory = asyncHandler(
    async (req: AuthRequest, res: Response) => {
        const userId = getUserId(req)
        const { categoryId } = req.body
        const transactionIds = parseBulkTransactionIds(req.body.transactionIds)

        validateRequiredFields({ categoryId }, ['categoryId'])
        await validateCategoryForTransaction(categoryId, userId)

        const transactions = await mapWithConcurrency(
            transactionIds,
            BULK_VALIDATION_CONCURRENCY,
            (transactionId) =>
                validateResourceAccess(
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
            (transaction) => (transaction.workspaceId?.toString() ?? null) !== (workspaceId?.toString() ?? null)
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

        handleResponses(res, 200, {
            message: `${transactions.length} transaction${transactions.length === 1 ? '' : 's'} updated`,
            updatedCount: transactions.length,
        })
    }
)
