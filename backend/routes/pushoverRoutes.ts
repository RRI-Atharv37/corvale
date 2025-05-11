import express from 'express'
import { pushoverToNextMonth } from '../controllers/pushoverController'
import { protect } from '../middleware/authMiddleware'

const router = express.Router()

router.post('/pushover', protect, pushoverToNextMonth)

export default router;