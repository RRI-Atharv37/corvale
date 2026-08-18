import express from 'express'

import { getSubscriptions } from '../controllers/subscriptionController'
import { protect } from '../middleware/authMiddleware'

const router = express.Router()

router.get('/', protect, getSubscriptions)

export default router
