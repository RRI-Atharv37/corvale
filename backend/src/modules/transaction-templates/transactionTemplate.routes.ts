import express from 'express'

import {
    applyTransactionTemplate,
    createTransactionTemplate,
    deleteTransactionTemplate,
    getTransactionTemplateById,
    getTransactionTemplates,
    updateTransactionTemplate,
} from './transactionTemplate.controller'
import { protect } from '@http/middleware/authMiddleware'
import { requireScopedWriteAccess, requireWriteAccess } from '@modules/billing/entitlement.middleware'
import { scopeFromBody } from '@modules/billing/billingScope'

const router = express.Router()

router.post('/:templateId/apply', protect, requireScopedWriteAccess(scopeFromBody), applyTransactionTemplate)
router.post('/', protect, requireWriteAccess, createTransactionTemplate)
router.get('/', protect, getTransactionTemplates)
router.get('/:templateId', protect, getTransactionTemplateById)
router.put('/:templateId', protect, requireWriteAccess, updateTransactionTemplate)
router.delete('/:templateId', protect, requireWriteAccess, deleteTransactionTemplate)

export default router
