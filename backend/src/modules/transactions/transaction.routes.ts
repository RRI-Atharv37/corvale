import express from 'express'

import {
    attachReceiptToTransaction,
    createTransaction,
    createTransfer,
    deleteTransaction,
    detachReceiptFromTransaction,
    duplicateTransaction,
    getTransactionById,
    updateTransaction,
} from './transaction.controller'
import {
    downloadTransactions,
    filterTransactions,
    getTransactions,
    searchTransactions,
} from './transactionQuery.controller'
import { bulkDeleteTransactions, bulkUpdateTransactionCategory } from './transactionBulk.controller'
import { updateClearedStatus } from '@modules/reconciliation/reconciliation.controller'
import { protect } from '@http/middleware/authMiddleware'
import { requireScopedWriteAccess } from '@modules/billing/entitlement.middleware'
import { scopeFromBody, scopeFromBodyResources, scopeFromResource } from '@modules/billing/billingScope'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import Transaction from './transaction.model'

const router = express.Router()

const scopeFromBulkTransactions = scopeFromBodyResources(Transaction, 'transactionIds', {
    notFoundMessage: ERROR_MESSAGES.TRANSACTION.TRANSACTION_NOT_FOUND,
    mixedScopeMessage: ERROR_MESSAGES.TRANSACTION.BULK_MIXED_SCOPE,
})

router.post('/', protect, requireScopedWriteAccess(scopeFromBody), createTransaction)
router.post('/transfer', protect, requireScopedWriteAccess(scopeFromBody), createTransfer)
router.post('/bulk/delete', protect, requireScopedWriteAccess(scopeFromBulkTransactions), bulkDeleteTransactions)
router.patch('/bulk/category', protect, requireScopedWriteAccess(scopeFromBulkTransactions), bulkUpdateTransactionCategory)
router.get('/', protect, getTransactions)
router.get('/filter', protect, filterTransactions)
router.get('/search', protect, searchTransactions)
router.get('/download', protect, downloadTransactions)
router.post('/duplicate/:transactionId', protect, requireScopedWriteAccess(scopeFromResource(Transaction, 'transactionId')), duplicateTransaction)
router.patch('/:transactionId/cleared-status', protect, requireScopedWriteAccess(scopeFromResource(Transaction, 'transactionId')), updateClearedStatus)
router.post('/:transactionId/receipts', protect, requireScopedWriteAccess(scopeFromResource(Transaction, 'transactionId')), attachReceiptToTransaction)
router.delete('/:transactionId/receipts/:receiptId', protect, requireScopedWriteAccess(scopeFromResource(Transaction, 'transactionId')), detachReceiptFromTransaction)
router.get('/:transactionId', protect, getTransactionById)
router.put('/:transactionId', protect, requireScopedWriteAccess(scopeFromResource(Transaction, 'transactionId')), updateTransaction)
router.delete('/:transactionId', protect, requireScopedWriteAccess(scopeFromResource(Transaction, 'transactionId')), deleteTransaction)

export default router
