import asyncHandler from 'express-async-handler'
import fs from 'fs'
import { Response } from 'express'
import { Types } from 'mongoose'

import Receipt from '../models/Receipt'
import Transaction from '../models/Transaction'
import { AuthRequest } from '../middleware/authTypes'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import {
    deleteReceiptRecord,
    deleteReceiptFile,
    getReceiptFilePath,
    serializeReceipt,
    validateReceiptOwnership,
} from '../utils/receiptUtils'
import { scanUploadedFile } from '../utils/virusScanService'
import { getUserId, handleResponses, validateRequiredFields } from '../utils/sharedUtils'

export const uploadReceipt = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    if (!req.file) {
        throw new CustomError(ERROR_MESSAGES.RECEIPT.FILE_REQUIRED, 400)
    }

    const filePath = getReceiptFilePath(userId, req.file.filename)

    try {
        await scanUploadedFile(filePath)
    } catch (error) {
        deleteReceiptFile(userId, req.file.filename)
        throw error
    }

    const receipt = await Receipt.create({
        userId,
        originalFilename: req.file.originalname,
        storedFilename: req.file.filename,
        mimeType: req.file.mimetype,
        size: req.file.size,
    })

    handleResponses(res, 201, serializeReceipt(receipt))
})

export const getReceiptFile = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { receiptId } = req.params

    validateRequiredFields({ receiptId }, ['receiptId'])

    const receipt = await validateReceiptOwnership(receiptId, userId)
    const filePath = getReceiptFilePath(userId, receipt.storedFilename)

    if (!fs.existsSync(filePath)) {
        throw new CustomError(ERROR_MESSAGES.RECEIPT.FILE_NOT_FOUND, 404)
    }

    res.setHeader('Content-Type', receipt.mimeType)
    res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(receipt.originalFilename)}"`
    )
    res.sendFile(filePath)
})

export const deleteReceipt = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { receiptId } = req.params

    validateRequiredFields({ receiptId }, ['receiptId'])

    const receipt = await validateReceiptOwnership(receiptId, userId)

    await Transaction.updateMany(
        { userId: new Types.ObjectId(userId), receiptIds: receipt._id },
        { $pull: { receiptIds: receipt._id } }
    )

    await deleteReceiptRecord(receipt, userId)

    handleResponses(res, 200, { message: 'Receipt deleted successfully' })
})
