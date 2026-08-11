import express from 'express'
import { getPushoverHistory, pushoverToNextMonth } from '../controllers/pushoverController'
import { protect } from '../middleware/authMiddleware'

const router = express.Router()

router.get('/history', protect, getPushoverHistory)
router.post('/pushover', protect, pushoverToNextMonth)

export default router;