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
} from './expense.controller'
import { protect } from '@http/middleware/authMiddleware'
import { requireWriteAccess } from '@modules/billing/entitlement.middleware'
import {
    attachLegacyLedgerDeprecation,
    deprecateLegacyLedgerRoutes,
} from './deprecation.middleware'

const router = express.Router()

router.use(deprecateLegacyLedgerRoutes, attachLegacyLedgerDeprecation)

router.post('/create', protect, requireWriteAccess, addExpense)
router.get('/', protect, getExpense)
router.get('/filter', protect, filterExpense)
router.get('/search', protect, searchExpense)
router.get('/group-by-category', protect, groupExpenseByCategory)
router.get('/group-by-payment-method', protect, groupExpenseByPaymentMethod)
router.get('/download', protect, downloadExpense)
router.get('/report', protect, generateExpenseReport)
router.post('/duplicate/:expenseId', protect, requireWriteAccess, duplicateExpense)
router.get('/:expenseId', protect, getExpenseById)
router.put('/:expenseId', protect, requireWriteAccess, updateExpense)
router.delete('/:expenseId', protect, requireWriteAccess, deleteExpense)

export default router
