import express from 'express'

import { getCalendar } from './calendar.controller'
import { protect } from '@http/middleware/authMiddleware'

const router = express.Router()

router.get('/', protect, getCalendar)

export default router
