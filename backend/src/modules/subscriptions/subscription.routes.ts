import express from 'express'

import { getSubscriptions } from './subscription.controller'
import { protect } from '@http/middleware/authMiddleware'

const router = express.Router()

router.get('/', protect, getSubscriptions)

export default router
