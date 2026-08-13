import multer, { FileFilterCallback } from 'multer'
import { Request } from 'express'

import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'

export const IMPORT_MAX_SIZE_BYTES = 2 * 1024 * 1024

const ALLOWED_MIME_TYPES = new Set([
    'text/csv',
    'application/csv',
    'text/plain',
    'application/vnd.ms-excel',
    'application/x-ofx',
    'application/ofx',
])

const ALLOWED_EXTENSIONS = new Set(['.csv', '.ofx', '.qfx'])

const isAllowedImportFile = (file: Express.Multer.File): boolean => {
    const extension = file.originalname.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
    if (ALLOWED_EXTENSIONS.has(extension)) {
        return true
    }
    return ALLOWED_MIME_TYPES.has(file.mimetype)
}

const fileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (!isAllowedImportFile(file)) {
        cb(new CustomError(ERROR_MESSAGES.IMPORT.INVALID_FILE_TYPE, 400))
        return
    }
    cb(null, true)
}

export const csvUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: IMPORT_MAX_SIZE_BYTES, files: 1 },
    fileFilter,
})

export const handleCsvUploadError = (
    err: unknown,
    _req: Request,
    _res: unknown,
    next: (error?: unknown) => void
): void => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            next(new CustomError(ERROR_MESSAGES.IMPORT.FILE_TOO_LARGE, 400))
            return
        }
        next(new CustomError(err.message, 400))
        return
    }
    next(err)
}
