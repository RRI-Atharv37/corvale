import express from 'express'

import { createReconciliationSession } from './reconciliation.controller'
import { protect } from '@http/middleware/authMiddleware'

const router = express.Router()

router.post('/', protect, createReconciliationSession)

export default router
