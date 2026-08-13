import express from 'express'

import { commitRestore, exportBackup, previewRestore } from '../controllers/backupController'
import { protect } from '../middleware/authMiddleware'
import { backupUpload, handleBackupUploadError } from '../middleware/backupUploadMiddleware'

const router = express.Router()

router.get('/export', protect, exportBackup)
router.post('/preview', protect, backupUpload.single('file'), handleBackupUploadError, previewRestore)
router.post('/restore', protect, backupUpload.single('file'), handleBackupUploadError, commitRestore)

export default router
