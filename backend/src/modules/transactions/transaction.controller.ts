import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import { AuthRequest } from '@http/middleware/authTypes'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'
import { validateRequiredFields } from '@core/http/validation'
import {
    attachReceipt,
    createTransfer as createTransferService,
    createTransactionForUser,
    deleteTransaction as deleteTransactionService,
    detachReceipt,
    duplicateTransaction as duplicateTransactionService,
    getTransactionDetail,
    updateTransactionForUser,
} from './transaction.service'

export const createTransaction = asyncHandler(async (req: AuthRequest, res: Response) => {
    const payload = await createTransactionForUser(getUserId(req), req.body)
    handleResponses(res, 201, payload)
})

export const createTransfer = asyncHandler(async (req: AuthRequest, res: Response) => {
    const payload = await createTransferService(getUserId(req), req.body)
    handleResponses(res, 201, payload)
})

export const getTransactionById = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { transactionId } = req.params
    validateRequiredFields({ transactionId }, ['transactionId'])

    handleResponses(res, 200, await getTransactionDetail(transactionId, getUserId(req)))
})

export const updateTransaction = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { transactionId } = req.params
    validateRequiredFields({ transactionId }, ['transactionId'])

    handleResponses(
        res,
        200,
        await updateTransactionForUser(transactionId, getUserId(req), req.body)
    )
})

export const deleteTransaction = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { transactionId } = req.params
    validateRequiredFields({ transactionId }, ['transactionId'])

    handleResponses(res, 200, await deleteTransactionService(transactionId, getUserId(req)))
})

export const duplicateTransaction = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { transactionId } = req.params
    validateRequiredFields({ transactionId }, ['transactionId'])

    handleResponses(res, 201, await duplicateTransactionService(transactionId, getUserId(req)))
})

export const attachReceiptToTransaction = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { transactionId } = req.params
    const { receiptId } = req.body

    validateRequiredFields({ transactionId, receiptId }, ['transactionId', 'receiptId'])

    handleResponses(res, 200, await attachReceipt(transactionId, receiptId, getUserId(req)))
})

export const detachReceiptFromTransaction = asyncHandler(
    async (req: AuthRequest, res: Response) => {
        const { transactionId, receiptId } = req.params

        validateRequiredFields({ transactionId, receiptId }, ['transactionId', 'receiptId'])

        handleResponses(res, 200, await detachReceipt(transactionId, receiptId, getUserId(req)))
    }
)
