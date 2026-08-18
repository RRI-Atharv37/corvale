import express from 'express'

import { planDebtPayoff } from '../controllers/debtPayoffController'
import { protect } from '../middleware/authMiddleware'

const router = express.Router()

router.post('/plan', protect, planDebtPayoff)

export default router
