import express from 'express'

import {
    applyTransactionTemplate,
    createTransactionTemplate,
    deleteTransactionTemplate,
    getTransactionTemplateById,
    getTransactionTemplates,
    updateTransactionTemplate,
} from '../controllers/transactionTemplateController'
import { protect } from '../middleware/authMiddleware'

const router = express.Router()

router.post('/:templateId/apply', protect, applyTransactionTemplate)
router.post('/', protect, createTransactionTemplate)
router.get('/', protect, getTransactionTemplates)
router.get('/:templateId', protect, getTransactionTemplateById)
router.put('/:templateId', protect, updateTransactionTemplate)
router.delete('/:templateId', protect, deleteTransactionTemplate)

export default router
