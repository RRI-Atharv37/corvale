import fs from 'fs'
import path from 'path'

import Receipt, { IReceipt } from '../models/Receipt'
import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'
import { validateOwnership } from './sharedUtils'

export const RECEIPT_MAX_SIZE_BYTES = 5 * 1024 * 1024

export const RECEIPT_ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
] as const

export type ReceiptMimeType = (typeof RECEIPT_ALLOWED_MIME_TYPES)[number]

export const RECEIPT_UPLOAD_ROOT = path.join(process.cwd(), 'uploads', 'receipts')

export interface SerializedReceipt {
    _id: string
    originalFilename: string
    mimeType: string
    size: number
    createdAt: Date
}

export const serializeReceipt = (receipt: IReceipt): SerializedReceipt => ({
    _id: receipt._id.toString(),
    originalFilename: receipt.originalFilename,
    mimeType: receipt.mimeType,
    size: receipt.size,
    createdAt: receipt.createdAt,
})

export const getUserReceiptDir = (userId: string): string =>
    path.join(RECEIPT_UPLOAD_ROOT, userId)

export const getReceiptFilePath = (userId: string, storedFilename: string): string =>
    path.join(getUserReceiptDir(userId), storedFilename)

export const ensureUserReceiptDir = (userId: string): string => {
    const dir = getUserReceiptDir(userId)
    fs.mkdirSync(dir, { recursive: true })
    return dir
}

export const validateReceiptOwnership = async (
    receiptId: string,
    userId: string
): Promise<IReceipt> => {
    return validateOwnership(
        Receipt,
        receiptId,
        userId,
        ERROR_MESSAGES.RECEIPT.RECEIPT_NOT_FOUND
    )
}

export const deleteReceiptFile = (userId: string, storedFilename: string): void => {
    const filePath = getReceiptFilePath(userId, storedFilename)
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
    }
}

export const deleteReceiptRecord = async (receipt: IReceipt, userId: string): Promise<void> => {
    deleteReceiptFile(userId, receipt.storedFilename)
    await Receipt.deleteOne({ _id: receipt._id })
}

export const assertAllowedReceiptMimeType = (mimeType: string): void => {
    if (!RECEIPT_ALLOWED_MIME_TYPES.includes(mimeType as ReceiptMimeType)) {
        throw new CustomError(ERROR_MESSAGES.RECEIPT.INVALID_FILE_TYPE, 400)
    }
}
