import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import { AuthRequest } from '@http/middleware/authTypes'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'
import { validateRequiredFields } from '@core/http/validation'
import {
    bulkDeleteTransactions as bulkDeleteTransactionsService,
    bulkUpdateTransactionCategory as bulkUpdateTransactionCategoryService,
} from './transactionBulk.service'

// SEC-61: bulk endpoints run one ownership-validating query per id. The array is caller-controlled,
// so it needs the same kind of ceiling the sync push has (`MAX_PUSH_OPS`).
const MAX_BULK_TRANSACTION_IDS = 500

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

export const bulkDeleteTransactions = asyncHandler(async (req: AuthRequest, res: Response) => {
    const transactionIds = parseBulkTransactionIds(req.body.transactionIds)

    handleResponses(res, 200, await bulkDeleteTransactionsService(getUserId(req), transactionIds))
})

export const bulkUpdateTransactionCategory = asyncHandler(
    async (req: AuthRequest, res: Response) => {
        const { categoryId } = req.body
        const transactionIds = parseBulkTransactionIds(req.body.transactionIds)

        validateRequiredFields({ categoryId }, ['categoryId'])

        handleResponses(
            res,
            200,
            await bulkUpdateTransactionCategoryService(getUserId(req), transactionIds, categoryId)
        )
    }
)
