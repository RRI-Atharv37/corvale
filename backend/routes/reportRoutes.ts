import express from 'express'

import {
    generateReport,
    getBudgetAnalysis,
    getCrossoverPoint,
    getIncomeVsExpense,
    getLargestExpenses,
    getRecurringTotals,
    getReportAverages,
    getSavingsRate,
    getSpendingAnalysis,
    getSpendingTrends,
    queryCustomReport,
} from '../controllers/reportController'
import {
    createSavedReport,
    deleteSavedReport,
    listSavedReports,
    runSavedReport,
    updateSavedReport,
} from '../controllers/savedReportController'
import { protect } from '@http/middleware/authMiddleware'

const router = express.Router()

router.get('/averages', protect, getReportAverages)
router.get('/largest-expenses', protect, getLargestExpenses)
router.get('/spending-trends', protect, getSpendingTrends)
router.get('/income-vs-expense', protect, getIncomeVsExpense)
router.get('/savings-rate', protect, getSavingsRate)
router.get('/recurring-totals', protect, getRecurringTotals)
router.get('/budget-analysis', protect, getBudgetAnalysis)
router.get('/spending-analysis', protect, getSpendingAnalysis)
router.get('/crossover-point', protect, getCrossoverPoint)
router.post('/query', protect, queryCustomReport)
router.post('/generate', protect, generateReport)

router.get('/saved', protect, listSavedReports)
router.post('/saved', protect, createSavedReport)
router.put('/saved/:reportId', protect, updateSavedReport)
router.delete('/saved/:reportId', protect, deleteSavedReport)
router.get('/saved/:reportId/run', protect, runSavedReport)

export default router
