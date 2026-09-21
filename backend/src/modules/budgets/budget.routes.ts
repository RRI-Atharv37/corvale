import express from 'express'

import {
    archiveBudget,
    createBudget,
    getBudgetById,
    getBudgetProgress,
    getBudgets,
    updateBudget,
} from './budget.controller'
import { protect } from '@http/middleware/authMiddleware'
import { requireScopedWriteAccess } from '@modules/billing/entitlement.middleware'
import { scopeFromBody, scopeFromResource } from '@modules/billing/billingScope'
import Budget from './budget.model'

const router = express.Router()

router.post('/', protect, requireScopedWriteAccess(scopeFromBody), createBudget)
router.get('/', protect, getBudgets)
router.get('/:budgetId/progress', protect, getBudgetProgress)
router.get('/:budgetId', protect, getBudgetById)
router.put('/:budgetId', protect, requireScopedWriteAccess(scopeFromResource(Budget, 'budgetId')), updateBudget)
router.delete('/:budgetId', protect, requireScopedWriteAccess(scopeFromResource(Budget, 'budgetId')), archiveBudget)

export default router
