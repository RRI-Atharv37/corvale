import express from 'express'
import { getPushoverHistory, pushoverToNextMonth } from './pushover.controller'
import { protect } from '@http/middleware/authMiddleware'
import { requireWriteAccess } from '@modules/billing/entitlement.middleware'

const router = express.Router()

router.get('/history', protect, getPushoverHistory)
router.post('/pushover', protect, requireWriteAccess, pushoverToNextMonth)

export default router;