import express from 'express'

import {
    bulkApplyRules,
    createCategorizationRule,
    deleteCategorizationRule,
    getCategorizationRuleById,
    getCategorizationRules,
    testCategorizationRule,
    updateCategorizationRule,
} from './categorizationRule.controller'
import { protect } from '@http/middleware/authMiddleware'
import { requireWriteAccess } from '@modules/billing/entitlement.middleware'

const router = express.Router()

router.post('/bulk-apply', protect, requireWriteAccess, bulkApplyRules)
router.post('/test', protect, testCategorizationRule)
router.post('/', protect, requireWriteAccess, createCategorizationRule)
router.get('/', protect, getCategorizationRules)
router.get('/:ruleId', protect, getCategorizationRuleById)
router.put('/:ruleId', protect, requireWriteAccess, updateCategorizationRule)
router.delete('/:ruleId', protect, requireWriteAccess, deleteCategorizationRule)

export default router
