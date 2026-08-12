import express from 'express'

import { deleteReceipt, getReceiptFile, uploadReceipt } from '../controllers/receiptController'
import { protect } from '../middleware/authMiddleware'
import { handleReceiptUploadError, receiptUpload } from '../middleware/receiptUploadMiddleware'

const router = express.Router()

router.post(
    '/',
    protect,
    receiptUpload.single('receipt'),
    handleReceiptUploadError,
    uploadReceipt
)
router.get('/:receiptId', protect, getReceiptFile)
router.delete('/:receiptId', protect, deleteReceipt)

export default router
