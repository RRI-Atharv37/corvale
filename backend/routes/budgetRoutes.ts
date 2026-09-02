import express from 'express'

import {
    archiveBudget,
    createBudget,
    getBudgetById,
    getBudgetProgress,
    getBudgets,
    updateBudget,
} from '../controllers/budgetController'
import { protect } from '@http/middleware/authMiddleware'

const router = express.Router()

router.post('/', protect, createBudget)
router.get('/', protect, getBudgets)
router.get('/:budgetId/progress', protect, getBudgetProgress)
router.get('/:budgetId', protect, getBudgetById)
router.put('/:budgetId', protect, updateBudget)
router.delete('/:budgetId', protect, archiveBudget)

export default router
