import express from 'express'

import {
    archiveAccount,
    createAccount,
    getAccountById,
    getAccounts,
    updateAccount,
} from '../controllers/accountController'
import { getReconciliationSessions } from '../controllers/reconciliationController'
import { protect } from '../middleware/authMiddleware'

const router = express.Router()

router.post('/', protect, createAccount)
router.get('/', protect, getAccounts)
router.get('/:accountId/reconciliation-sessions', protect, getReconciliationSessions)
router.get('/:accountId', protect, getAccountById)
router.put('/:accountId', protect, updateAccount)
router.delete('/:accountId', protect, archiveAccount)

export default router
