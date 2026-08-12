import express from 'express'

import {
    createTransaction,
    deleteTransaction,
    downloadTransactions,
    duplicateTransaction,
    filterTransactions,
    getTransactionById,
    getTransactions,
    searchTransactions,
    updateTransaction,
} from '../controllers/transactionController'
import { protect } from '../middleware/authMiddleware'

const router = express.Router()

router.post('/', protect, createTransaction)
router.get('/', protect, getTransactions)
router.get('/filter', protect, filterTransactions)
router.get('/search', protect, searchTransactions)
router.get('/download', protect, downloadTransactions)
router.post('/duplicate/:transactionId', protect, duplicateTransaction)
router.get('/:transactionId', protect, getTransactionById)
router.put('/:transactionId', protect, updateTransaction)
router.delete('/:transactionId', protect, deleteTransaction)

export default router
