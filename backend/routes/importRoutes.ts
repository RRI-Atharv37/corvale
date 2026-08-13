import express from 'express'

import {
    commitImport,
    parseImportFile,
    previewImport,
} from '../controllers/importController'
import { protect } from '../middleware/authMiddleware'
import { csvUpload, handleCsvUploadError } from '../middleware/csvUploadMiddleware'

const router = express.Router()

router.post(
    '/parse',
    protect,
    csvUpload.single('file'),
    handleCsvUploadError,
    parseImportFile
)
router.post('/preview', protect, previewImport)
router.post('/commit', protect, commitImport)

export default router
