import crypto from 'crypto'
import path from 'path'

import multer, { FileFilterCallback } from 'multer'
import { Request } from 'express'

import { AuthRequest } from './authTypes'
import { MULTIPART_TEXT_LIMITS } from './multipartLimits'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import {
    assertAllowedReceiptMimeType,
    ensureUserReceiptDir,
    RECEIPT_MAX_SIZE_BYTES,
} from '../utils/receiptUtils'

const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
        const userId = (req as AuthRequest).user?._id?.toString()
        if (!userId) {
            cb(new CustomError(ERROR_MESSAGES.AUTH.TOKEN_MISSING, 401), '')
            return
        }
        cb(null, ensureUserReceiptDir(userId))
    },
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase()
        const safeExt = ext.length <= 10 ? ext : ''
        cb(null, `${crypto.randomUUID()}${safeExt}`)
    },
})

const fileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    try {
        assertAllowedReceiptMimeType(file.mimetype)
        cb(null, true)
    } catch (error) {
        cb(error instanceof CustomError ? error : new Error('Invalid file type'))
    }
}

export const receiptUpload = multer({
    storage,
    limits: { fileSize: RECEIPT_MAX_SIZE_BYTES, files: 1, ...MULTIPART_TEXT_LIMITS },
    fileFilter,
})

export const handleReceiptUploadError = (
    err: unknown,
    _req: Request,
    _res: unknown,
    next: (error?: unknown) => void
): void => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            next(new CustomError(ERROR_MESSAGES.RECEIPT.FILE_TOO_LARGE, 400))
            return
        }
        next(new CustomError(err.message, 400))
        return
    }
    next(err)
}
