import express from 'express'

import { getSubscriptions } from '../controllers/subscriptionController'
import { protect } from '@http/middleware/authMiddleware'

const router = express.Router()

router.get('/', protect, getSubscriptions)

export default router
