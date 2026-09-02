import express from 'express'

import { createReconciliationSession } from '../controllers/reconciliationController'
import { protect } from '@http/middleware/authMiddleware'

const router = express.Router()

router.post('/', protect, createReconciliationSession)

export default router
