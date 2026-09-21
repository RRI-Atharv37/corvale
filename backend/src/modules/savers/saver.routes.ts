import express from 'express'
import { addSaver, withdrawSaver, getSaver } from './saver.controller'
import { protect } from '@http/middleware/authMiddleware'
import { requireWriteAccess } from '@modules/billing/entitlement.middleware'

const router = express.Router()

router.post('/add', protect, requireWriteAccess, addSaver)
router.post('/withdraw', protect, requireWriteAccess, withdrawSaver)
router.get('/details', protect, getSaver)

export default router