import express from 'express'

import { getForecast } from '../controllers/forecastController'
import { protect } from '@http/middleware/authMiddleware'

const router = express.Router()

router.get('/', protect, getForecast)

export default router
