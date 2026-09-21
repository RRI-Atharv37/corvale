import express from 'express'

import {
    commitImport,
    parseImportFile,
    previewImport,
} from './import.controller'
import { protect } from '@http/middleware/authMiddleware'
import { requireScopedWriteAccess } from '@modules/billing/entitlement.middleware'
import { scopeFromBody } from '@modules/billing/billingScope'
import { csvUpload, handleCsvUploadError } from './csvUpload.middleware'
import { sanitizeBody } from '@http/middleware/sanitizeBodyMiddleware'

const router = express.Router()

// sanitizeBody runs app-level, before multer parses the multipart body, so it must be
// re-run here once multer has populated req.body from the text fields (SEC-35).
router.post(
    '/parse',
    protect,
    csvUpload.single('file'),
    handleCsvUploadError,
    sanitizeBody,
    parseImportFile
)
router.post('/preview', protect, previewImport)
router.post('/commit', protect, requireScopedWriteAccess(scopeFromBody), commitImport)

export default router
