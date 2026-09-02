import express from 'express'

import { getForecast } from './forecast.controller'
import { protect } from '@http/middleware/authMiddleware'

const router = express.Router()

router.get('/', protect, getForecast)

export default router
