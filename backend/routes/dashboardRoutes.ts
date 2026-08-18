import express from 'express'

import {
    getDashboardCashFlow,
    getDashboardCategoryBreakdown,
    getDashboardOverview,
    getDashboardSummary,
    getNetWorthTrend,
    getBudgetOverview,
} from '../controllers/dashboardController'
import { protect } from '../middleware/authMiddleware'

const router = express.Router()

router.get('/', protect, getDashboardOverview)
router.get('/summary', protect, getDashboardSummary)
router.get('/cash-flow', protect, getDashboardCashFlow)
router.get('/category-breakdown', protect, getDashboardCategoryBreakdown)
router.get('/net-worth-trend', protect, getNetWorthTrend)
router.get('/budget-overview', protect, getBudgetOverview)

export default router
