import express from 'express'

import {
    attachReceiptToTransaction,
    bulkDeleteTransactions,
    bulkUpdateTransactionCategory,
    createTransaction,
    createTransfer,
    deleteTransaction,
    detachReceiptFromTransaction,
    downloadTransactions,
    duplicateTransaction,
    filterTransactions,
    getTransactionById,
    getTransactions,
    searchTransactions,
    updateTransaction,
} from './transaction.controller'
import { updateClearedStatus } from '@modules/reconciliation/reconciliation.controller'
import { protect } from '@http/middleware/authMiddleware'

const router = express.Router()

router.post('/', protect, createTransaction)
router.post('/transfer', protect, createTransfer)
router.post('/bulk/delete', protect, bulkDeleteTransactions)
router.patch('/bulk/category', protect, bulkUpdateTransactionCategory)
router.get('/', protect, getTransactions)
router.get('/filter', protect, filterTransactions)
router.get('/search', protect, searchTransactions)
router.get('/download', protect, downloadTransactions)
router.post('/duplicate/:transactionId', protect, duplicateTransaction)
router.patch('/:transactionId/cleared-status', protect, updateClearedStatus)
router.post('/:transactionId/receipts', protect, attachReceiptToTransaction)
router.delete('/:transactionId/receipts/:receiptId', protect, detachReceiptFromTransaction)
router.get('/:transactionId', protect, getTransactionById)
router.put('/:transactionId', protect, updateTransaction)
router.delete('/:transactionId', protect, deleteTransaction)

export default router
