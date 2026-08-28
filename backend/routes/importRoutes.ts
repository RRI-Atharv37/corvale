import express from 'express'

import {
    commitImport,
    parseImportFile,
    previewImport,
} from '../controllers/importController'
import { protect } from '../middleware/authMiddleware'
import { csvUpload, handleCsvUploadError } from '../middleware/csvUploadMiddleware'
import { sanitizeBody } from '../middleware/sanitizeBodyMiddleware'

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
router.post('/commit', protect, commitImport)

export default router
