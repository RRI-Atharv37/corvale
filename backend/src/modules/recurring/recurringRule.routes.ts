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
} from './recurringRule.controller'
import { protect } from '@http/middleware/authMiddleware'
import { requireScopedWriteAccess } from '@modules/billing/entitlement.middleware'
import { scopeFromBody, scopeFromQuery, scopeFromResource } from '@modules/billing/billingScope'
import RecurringRule from './recurringRule.model'
import { Transaction } from '@modules/transactions'

const router = express.Router()

router.post('/', protect, requireScopedWriteAccess(scopeFromBody), createRecurringRule)
router.get('/', protect, getRecurringRules)
router.post('/generate-drafts', protect, requireScopedWriteAccess(scopeFromQuery), generateRecurringDrafts)
router.get('/drafts', protect, getRecurringDrafts)
router.post('/drafts/:transactionId/confirm', protect, requireScopedWriteAccess(scopeFromResource(Transaction, 'transactionId')), confirmDraft)
router.post('/drafts/:transactionId/dismiss', protect, requireScopedWriteAccess(scopeFromResource(Transaction, 'transactionId')), dismissDraft)
router.post('/:ruleId/generate-drafts', protect, requireScopedWriteAccess(scopeFromResource(RecurringRule, 'ruleId')), generateRecurringDraftsForRule)
router.get('/:ruleId', protect, getRecurringRuleById)
router.put('/:ruleId', protect, requireScopedWriteAccess(scopeFromResource(RecurringRule, 'ruleId')), updateRecurringRule)
router.delete('/:ruleId', protect, requireScopedWriteAccess(scopeFromResource(RecurringRule, 'ruleId')), archiveRecurringRule)

export default router
