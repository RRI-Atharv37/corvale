import express from 'express'

import { createReconciliationSession } from './reconciliation.controller'
import { protect } from '@http/middleware/authMiddleware'
import { requireScopedWriteAccess } from '@modules/billing/entitlement.middleware'
import { scopeFromBodyResource } from '@modules/billing/billingScope'
import { Account } from '@modules/accounts'

const router = express.Router()

router.post('/', protect, requireScopedWriteAccess(scopeFromBodyResource(Account, 'accountId')), createReconciliationSession)

export default router
