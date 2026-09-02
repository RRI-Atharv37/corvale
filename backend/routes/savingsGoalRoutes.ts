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
} from '../controllers/savingsGoalController'
import { protect } from '@http/middleware/authMiddleware'

const router = express.Router()

router.post('/', protect, createSavingsGoal)
router.get('/', protect, getSavingsGoals)
router.get('/:goalId/progress', protect, getSavingsGoalProgress)
router.get('/:goalId/contributions', protect, getContributionHistory)
router.post('/:goalId/contribute', protect, contributeToSavingsGoal)
router.post('/:goalId/auto-contribute', protect, processAutoContribution)
router.post('/:goalId/pause', protect, pauseSavingsGoal)
router.post('/:goalId/resume', protect, resumeSavingsGoal)
router.post('/:goalId/complete', protect, completeSavingsGoal)
router.get('/:goalId', protect, getSavingsGoalById)
router.put('/:goalId', protect, updateSavingsGoal)
router.delete('/:goalId', protect, archiveSavingsGoal)

export default router
