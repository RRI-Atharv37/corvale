import express from 'express'

import { pushSyncOps } from '../controllers/syncController'
import { protect } from '../middleware/authMiddleware'

const router = express.Router()

router.post('/push', protect, pushSyncOps)

export default router
