import express from 'express'

import {
    archiveRecurringRule,
    confirmDraft,
    createRecurringRule,
    dismissDraft,
    generateRecurringDrafts,
    generateRecurringDraftsForRule,
    getRecurringDrafts,
    getRecurringRuleById,
    getRecurringRules,
    updateRecurringRule,
} from '../controllers/recurringRuleController'
import { protect } from '@http/middleware/authMiddleware'

const router = express.Router()

router.post('/', protect, createRecurringRule)
router.get('/', protect, getRecurringRules)
router.post('/generate-drafts', protect, generateRecurringDrafts)
router.get('/drafts', protect, getRecurringDrafts)
router.post('/drafts/:transactionId/confirm', protect, confirmDraft)
router.post('/drafts/:transactionId/dismiss', protect, dismissDraft)
router.post('/:ruleId/generate-drafts', protect, generateRecurringDraftsForRule)
router.get('/:ruleId', protect, getRecurringRuleById)
router.put('/:ruleId', protect, updateRecurringRule)
router.delete('/:ruleId', protect, archiveRecurringRule)

export default router
