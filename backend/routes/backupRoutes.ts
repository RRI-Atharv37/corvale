import express from 'express'

import { commitRestore, exportBackup, previewRestore } from '../controllers/backupController'
import { protect } from '@http/middleware/authMiddleware'
import { backupUpload, handleBackupUploadError } from '../middleware/backupUploadMiddleware'
import { sanitizeBody } from '@http/middleware/sanitizeBodyMiddleware'

const router = express.Router()

// sanitizeBody runs app-level, before multer parses the multipart body, so it must be
// re-run here once multer has populated req.body from the text fields (SEC-35).
router.get('/export', protect, exportBackup)
router.post(
    '/preview',
    protect,
    backupUpload.single('file'),
    handleBackupUploadError,
    sanitizeBody,
    previewRestore
)
router.post(
    '/restore',
    protect,
    backupUpload.single('file'),
    handleBackupUploadError,
    sanitizeBody,
    commitRestore
)

export default router
