import multer, { FileFilterCallback } from 'multer'
import { Request } from 'express'

import { MULTIPART_TEXT_LIMITS } from '@core/http/multipartLimits'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { BACKUP_MAX_ZIP_BYTES } from './backupUtils'

const ALLOWED_EXTENSIONS = new Set(['.json', '.zip'])

const isAllowedBackupFile = (file: Express.Multer.File): boolean => {
    const extension = file.originalname.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
    return ALLOWED_EXTENSIONS.has(extension)
}

const fileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (!isAllowedBackupFile(file)) {
        cb(new CustomError(ERROR_MESSAGES.BACKUP.INVALID_FILE_TYPE, 400))
        return
    }
    cb(null, true)
}

export const backupUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: BACKUP_MAX_ZIP_BYTES, files: 1, ...MULTIPART_TEXT_LIMITS },
    fileFilter,
})

export const handleBackupUploadError = (
    err: unknown,
    _req: Request,
    _res: unknown,
    next: (error?: unknown) => void
): void => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            next(new CustomError(ERROR_MESSAGES.BACKUP.FILE_TOO_LARGE, 400))
            return
        }
        next(new CustomError(err.message, 400))
        return
    }
    next(err)
}
