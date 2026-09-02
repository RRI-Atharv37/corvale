import express from 'express'
import {
    addExpense,
    getExpense,
    getExpenseById,
    updateExpense,
    deleteExpense,
    filterExpense,
    searchExpense,
    groupExpenseByCategory,
    groupExpenseByPaymentMethod,
    downloadExpense,
    generateExpenseReport,
    duplicateExpense,
} from '../controllers/expenseController'
import { protect } from '@http/middleware/authMiddleware'
import {
    attachLegacyLedgerDeprecation,
    deprecateLegacyLedgerRoutes,
} from '../middleware/deprecationMiddleware'

const router = express.Router()

router.use(deprecateLegacyLedgerRoutes, attachLegacyLedgerDeprecation)

router.post('/create', protect, addExpense)
router.get('/', protect, getExpense)
router.get('/filter', protect, filterExpense)
router.get('/search', protect, searchExpense)
router.get('/group-by-category', protect, groupExpenseByCategory)
router.get('/group-by-payment-method', protect, groupExpenseByPaymentMethod)
router.get('/download', protect, downloadExpense)
router.get('/report', protect, generateExpenseReport)
router.post('/duplicate/:expenseId', protect, duplicateExpense)
router.get('/:expenseId', protect, getExpenseById)
router.put('/:expenseId', protect, updateExpense)
router.delete('/:expenseId', protect, deleteExpense)

export default router
