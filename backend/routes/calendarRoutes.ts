import express from 'express'

import { getCalendar } from '../controllers/calendarController'
import { protect } from '@http/middleware/authMiddleware'

const router = express.Router()

router.get('/', protect, getCalendar)

export default router
