import express from 'express'

import { planDebtPayoff } from './debt.controller'
import { protect } from '@http/middleware/authMiddleware'

const router = express.Router()

router.post('/plan', protect, planDebtPayoff)

export default router
