import express from 'express'
import { protect } from '../middleware/authMiddleware'

import { registerUser, loginUser, getUserInfo } from '../controllers/authController'
const router = express.Router()

router.post('/register', registerUser)
router.post('/login', loginUser)
router.get('/user', protect, getUserInfo)

export default router