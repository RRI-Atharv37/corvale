import express from 'express'

import {
    archiveSavingsGoal,
    completeSavingsGoal,
    contributeToSavingsGoal,
    createSavingsGoal,
    getContributionHistory,
    getSavingsGoalById,
    getSavingsGoalProgress,
    getSavingsGoals,
    pauseSavingsGoal,
    processAutoContribution,
    resumeSavingsGoal,
    updateSavingsGoal,
} from './savingsGoal.controller'
import { protect } from '@http/middleware/authMiddleware'
import { requireScopedWriteAccess } from '@modules/billing/entitlement.middleware'
import { scopeFromBody, scopeFromResource } from '@modules/billing/billingScope'
import SavingsGoal from './savingsGoal.model'

const router = express.Router()

router.post('/', protect, requireScopedWriteAccess(scopeFromBody), createSavingsGoal)
router.get('/', protect, getSavingsGoals)
router.get('/:goalId/progress', protect, getSavingsGoalProgress)
router.get('/:goalId/contributions', protect, getContributionHistory)
router.post('/:goalId/contribute', protect, requireScopedWriteAccess(scopeFromResource(SavingsGoal, 'goalId')), contributeToSavingsGoal)
router.post('/:goalId/auto-contribute', protect, requireScopedWriteAccess(scopeFromResource(SavingsGoal, 'goalId')), processAutoContribution)
router.post('/:goalId/pause', protect, requireScopedWriteAccess(scopeFromResource(SavingsGoal, 'goalId')), pauseSavingsGoal)
router.post('/:goalId/resume', protect, requireScopedWriteAccess(scopeFromResource(SavingsGoal, 'goalId')), resumeSavingsGoal)
router.post('/:goalId/complete', protect, requireScopedWriteAccess(scopeFromResource(SavingsGoal, 'goalId')), completeSavingsGoal)
router.get('/:goalId', protect, getSavingsGoalById)
router.put('/:goalId', protect, requireScopedWriteAccess(scopeFromResource(SavingsGoal, 'goalId')), updateSavingsGoal)
router.delete('/:goalId', protect, requireScopedWriteAccess(scopeFromResource(SavingsGoal, 'goalId')), archiveSavingsGoal)

export default router
