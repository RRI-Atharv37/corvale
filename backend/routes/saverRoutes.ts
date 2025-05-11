import express from 'express'
import { addSaver, withdrawSaver, getSaver } from '../controllers/saverController'
import {protect} from '../middleware/authMiddleware'

const router = express.Router()

router.post('/add', protect, addSaver)
router.post('/withdraw', protect, withdrawSaver)
router.get('/details', protect, getSaver)

export default router