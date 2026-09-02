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

const router = express.Router()

router.post('/bulk-apply', protect, bulkApplyRules)
router.post('/test', protect, testCategorizationRule)
router.post('/', protect, createCategorizationRule)
router.get('/', protect, getCategorizationRules)
router.get('/:ruleId', protect, getCategorizationRuleById)
router.put('/:ruleId', protect, updateCategorizationRule)
router.delete('/:ruleId', protect, deleteCategorizationRule)

export default router
