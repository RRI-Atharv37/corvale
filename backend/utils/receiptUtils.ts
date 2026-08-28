import fs from 'fs'
import path from 'path'

import { Types } from 'mongoose'

import Receipt, { IReceipt } from '../models/Receipt'
import { CustomError } from './customError'
import { ERROR_MESSAGES } from './errorMessages'
import { detectReceiptSignature } from './fileSignature'
import { RECEIPT_ALLOWED_MIME_TYPES, ReceiptMimeType } from './receiptMimeTypes'
import { deleteReceiptObject, isObjectStorageConfigured, receiptObjectKey } from './receiptStorage'
import { validateOwnership } from './sharedUtils'

export const RECEIPT_MAX_SIZE_BYTES = 5 * 1024 * 1024

export { RECEIPT_ALLOWED_MIME_TYPES }
export type { ReceiptMimeType }

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
    if (isObjectStorageConfigured()) {
        await deleteReceiptObject(receiptObjectKey(userId, receipt.storedFilename))
    } else {
        deleteReceiptFile(userId, receipt.storedFilename)
    }
    receipt.deletedAt = new Date()
    await receipt.save()
}

export const assertAllowedReceiptMimeType = (mimeType: string): void => {
    if (!RECEIPT_ALLOWED_MIME_TYPES.includes(mimeType as ReceiptMimeType)) {
        throw new CustomError(ERROR_MESSAGES.RECEIPT.INVALID_FILE_TYPE, 400)
    }
}

/**
 * Validates raw receipt bytes the same way the upload endpoint does — size cap, magic-byte
 * sniff, allowlist — and returns the *detected* MIME type. Used by both the multipart upload
 * path and backup restore (SEC-28) so a restored receipt cannot smuggle past the checks a
 * direct upload enforces. The virus scan and storage-quota checks are left to the caller,
 * since they need the file on disk / the caller's accumulated usage respectively.
 */
export const assertValidReceiptBuffer = (buffer: Buffer): ReceiptMimeType => {
    if (buffer.byteLength > RECEIPT_MAX_SIZE_BYTES) {
        throw new CustomError(ERROR_MESSAGES.RECEIPT.FILE_TOO_LARGE, 400)
    }

    const detected = detectReceiptSignature(buffer)
    if (!detected) {
        throw new CustomError(ERROR_MESSAGES.RECEIPT.INVALID_FILE_TYPE, 400)
    }
    assertAllowedReceiptMimeType(detected)
    return detected
}

/**
 * Sum of the caller's own non-deleted receipt sizes. Soft-deleted receipts are excluded
 * automatically by `softDeletePlugin`'s aggregate hook (SEC-23 quota).
 */
export const getUserReceiptStorageUsageBytes = async (userId: string): Promise<number> => {
    const result = await Receipt.aggregate([
        { $match: { userId: new Types.ObjectId(userId) } },
        { $group: { _id: null, total: { $sum: '$size' } } },
    ])
    return result[0]?.total ?? 0
}

/**
 * Per-user storage quota (L3/SEC-23), applies under either storage driver. No-op when
 * RECEIPT_STORAGE_QUOTA_BYTES is unset.
 */
export const assertWithinReceiptStorageQuota = async (
    userId: string,
    incomingSizeBytes: number
): Promise<void> => {
    const quotaBytes = process.env.RECEIPT_STORAGE_QUOTA_BYTES
    if (!quotaBytes) {
        return
    }

    const quota = Number(quotaBytes)
    const currentUsage = await getUserReceiptStorageUsageBytes(userId)

    if (currentUsage + incomingSizeBytes > quota) {
        throw new CustomError(ERROR_MESSAGES.RECEIPT.STORAGE_QUOTA_EXCEEDED, 400)
    }
}
