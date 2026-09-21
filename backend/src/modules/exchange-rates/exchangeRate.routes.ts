import express from 'express'

import {
    createExchangeRate,
    deleteExchangeRate,
    getExchangeRates,
    updateExchangeRate,
} from './exchangeRate.controller'
import { protect } from '@http/middleware/authMiddleware'
import { requireWriteAccess } from '@modules/billing/entitlement.middleware'

const router = express.Router()

router.get('/', protect, getExchangeRates)
router.post('/', protect, requireWriteAccess, createExchangeRate)
router.patch('/:pair', protect, requireWriteAccess, updateExchangeRate)
router.delete('/:pair', protect, requireWriteAccess, deleteExchangeRate)

export default router
