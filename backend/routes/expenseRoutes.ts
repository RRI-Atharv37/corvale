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
import { protect } from '../middleware/authMiddleware'

const router = express.Router()


router.post('/create', protect, addExpense)
router.get('/', protect, getExpense)
router.get('/:expenseId', protect, getExpenseById) 
router.put('/:expenseId', protect, updateExpense)
router.delete('/:expenseId', protect, deleteExpense)
router.get('/filter', protect, filterExpense)
router.get('/search', protect, searchExpense)
router.get('/group-by-category', protect, groupExpenseByCategory)
router.get('/group-by-payment-method', protect, groupExpenseByPaymentMethod)
router.get('/download', protect, downloadExpense)
router.get('/report', protect, generateExpenseReport)
router.post('/duplicate/:expenseId', protect, duplicateExpense) 

export default router