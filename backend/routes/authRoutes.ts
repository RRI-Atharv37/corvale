import express from 'express'
import { protect } from '../middleware/authMiddleware'
import { createAuthRateLimiter } from '../middleware/rateLimitMiddleware'
import { registerUser, loginUser, getUserInfo } from '../controllers/authController'

export const createAuthRoutes = (): express.Router => {
    const router = express.Router()
    const authRateLimiter = createAuthRateLimiter()

    router.post('/register', authRateLimiter, registerUser)
    router.post('/login', authRateLimiter, loginUser)
    router.get('/user', protect, getUserInfo)

    return router
}

export default createAuthRoutes()
