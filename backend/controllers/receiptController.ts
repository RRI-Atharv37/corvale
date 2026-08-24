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
    assertWithinReceiptStorageQuota,
    deleteReceiptRecord,
    deleteReceiptFile,
    getReceiptFilePath,
    serializeReceipt,
    validateReceiptOwnership,
} from '../utils/receiptUtils'
import { detectReceiptSignature } from '../utils/fileSignature'
import {
    getReceiptSignedDownloadUrl,
    isObjectStorageConfigured,
    putReceiptObject,
    receiptObjectKey,
} from '../utils/receiptStorage'
import { scanUploadedFile } from '../utils/virusScanService'
import { getUserId, handleResponses, validateRequiredFields } from '../utils/sharedUtils'

export const uploadReceipt = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    if (!req.file) {
        throw new CustomError(ERROR_MESSAGES.RECEIPT.FILE_REQUIRED, 400)
    }

    const filePath = getReceiptFilePath(userId, req.file.filename)

    try {
        await assertWithinReceiptStorageQuota(userId, req.file.size)
    } catch (error) {
        deleteReceiptFile(userId, req.file.filename)
        throw error
    }

    // Sniff the actual bytes rather than trusting the client-declared Content-Type (S14/SEC-15):
    // a mismatch is indistinguishable from a spoofed declaration at the API boundary, so both
    // are rejected the same way as an unsupported type.
    const detectedMimeType = detectReceiptSignature(fs.readFileSync(filePath))
    if (!detectedMimeType || detectedMimeType !== req.file.mimetype) {
        deleteReceiptFile(userId, req.file.filename)
        throw new CustomError(ERROR_MESSAGES.RECEIPT.INVALID_FILE_TYPE, 400)
    }

    try {
        await scanUploadedFile(filePath)
    } catch (error) {
        deleteReceiptFile(userId, req.file.filename)
        throw error
    }

    if (isObjectStorageConfigured()) {
        const key = receiptObjectKey(userId, req.file.filename)
        await putReceiptObject(key, filePath, detectedMimeType)
        // Object storage is now the only copy - the local disk write was only ever staging
        // for the virus scan and the upload, so a redeploy can no longer lose it (SEC-23).
        deleteReceiptFile(userId, req.file.filename)
    }

    const receipt = await Receipt.create({
        userId,
        originalFilename: req.file.originalname,
        storedFilename: req.file.filename,
        mimeType: detectedMimeType,
        size: req.file.size,
    })

    handleResponses(res, 201, serializeReceipt(receipt))
})

export const getReceiptFile = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { receiptId } = req.params

    validateRequiredFields({ receiptId }, ['receiptId'])

    const receipt = await validateReceiptOwnership(receiptId, userId)

    // Independent of any global Helmet configuration (S14/SEC-15): a receipt whose bytes are
    // sniffed as something other than its declared type must still not be MIME-sniffed by the
    // browser into rendering as that type.
    res.setHeader('X-Content-Type-Options', 'nosniff')

    if (isObjectStorageConfigured()) {
        const key = receiptObjectKey(userId, receipt.storedFilename)
        const signedUrl = await getReceiptSignedDownloadUrl(key)
        res.redirect(302, signedUrl)
        return
    }

    const filePath = getReceiptFilePath(userId, receipt.storedFilename)

    if (!fs.existsSync(filePath)) {
        throw new CustomError(ERROR_MESSAGES.RECEIPT.FILE_NOT_FOUND, 404)
    }

    // PDFs render inline in the browser's own PDF engine from the API origin otherwise;
    // images stay inline for the existing preview UI.
    const disposition = receipt.mimeType === 'application/pdf' ? 'attachment' : 'inline'
    res.setHeader('Content-Type', receipt.mimeType)
    res.setHeader(
        'Content-Disposition',
        `${disposition}; filename="${encodeURIComponent(receipt.originalFilename)}"`
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
