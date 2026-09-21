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
import { requireScopedWriteAccess } from '@modules/billing/entitlement.middleware'
import { scopeFromBody, scopeFromResource } from '@modules/billing/billingScope'
import Account from './account.model'

const router = express.Router()

router.post('/', protect, requireScopedWriteAccess(scopeFromBody), createAccount)
router.get('/', protect, getAccounts)
router.get('/:accountId/reconciliation-sessions', protect, getReconciliationSessions)
router.post('/:accountId/recompute-balance', protect, requireScopedWriteAccess(scopeFromResource(Account, 'accountId')), recomputeBalance)
router.get('/:accountId', protect, getAccountById)
router.put('/:accountId', protect, requireScopedWriteAccess(scopeFromResource(Account, 'accountId')), updateAccount)
router.delete('/:accountId', protect, requireScopedWriteAccess(scopeFromResource(Account, 'accountId')), archiveAccount)

export default router
