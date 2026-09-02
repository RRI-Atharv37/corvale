import express from 'express'
import { addSaver, withdrawSaver, getSaver } from './saver.controller'
import {protect} from '@http/middleware/authMiddleware'

const router = express.Router()

router.post('/add', protect, addSaver)
router.post('/withdraw', protect, withdrawSaver)
router.get('/details', protect, getSaver)

export default router