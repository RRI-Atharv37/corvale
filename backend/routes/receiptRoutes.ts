import express from 'express'

import { deleteReceipt, getReceiptFile, uploadReceipt } from '../controllers/receiptController'
import { protect } from '@http/middleware/authMiddleware'
import { handleReceiptUploadError, receiptUpload } from '../middleware/receiptUploadMiddleware'
import { sanitizeBody } from '@http/middleware/sanitizeBodyMiddleware'

const router = express.Router()

// sanitizeBody runs app-level, before multer parses the multipart body, so it must be
// re-run here once multer has populated req.body from the text fields (SEC-35).
router.post(
    '/',
    protect,
    receiptUpload.single('receipt'),
    handleReceiptUploadError,
    sanitizeBody,
    uploadReceipt
)
router.get('/:receiptId', protect, getReceiptFile)
router.delete('/:receiptId', protect, deleteReceipt)

export default router
