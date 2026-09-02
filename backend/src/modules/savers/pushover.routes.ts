import express from 'express'
import { getPushoverHistory, pushoverToNextMonth } from './pushover.controller'
import { protect } from '@http/middleware/authMiddleware'

const router = express.Router()

router.get('/history', protect, getPushoverHistory)
router.post('/pushover', protect, pushoverToNextMonth)

export default router;