import express from 'express'

import {
    createExchangeRate,
    deleteExchangeRate,
    getExchangeRates,
    updateExchangeRate,
} from '../controllers/exchangeRateController'
import { protect } from '../middleware/authMiddleware'

const router = express.Router()

router.get('/', protect, getExchangeRates)
router.post('/', protect, createExchangeRate)
router.patch('/:pair', protect, updateExchangeRate)
router.delete('/:pair', protect, deleteExchangeRate)

export default router
