import express from 'express'

import {
    archiveAccount,
    createAccount,
    getAccountById,
    getAccounts,
    recomputeBalance,
    updateAccount,
} from './account.controller'
import { getReconciliationSessions } from '@modules/reconciliation/reconciliation.controller'
import { protect } from '@http/middleware/authMiddleware'

const router = express.Router()

router.post('/', protect, createAccount)
router.get('/', protect, getAccounts)
router.get('/:accountId/reconciliation-sessions', protect, getReconciliationSessions)
router.post('/:accountId/recompute-balance', protect, recomputeBalance)
router.get('/:accountId', protect, getAccountById)
router.put('/:accountId', protect, updateAccount)
router.delete('/:accountId', protect, archiveAccount)

export default router
