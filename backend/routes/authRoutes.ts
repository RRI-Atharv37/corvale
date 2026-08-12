import express from 'express'
import { protect } from '../middleware/authMiddleware'
import { createAuthRateLimiter } from '../middleware/rateLimitMiddleware'
import {
    registerUser,
    loginUser,
    getUserInfo,
    refreshAccessToken,
    logoutUser,
    logoutAllSessions,
    requestPasswordReset,
    confirmPasswordReset,
    updateUserPreferences,
} from '../controllers/authController'

export const createAuthRoutes = (): express.Router => {
    const router = express.Router()
    const authRateLimiter = createAuthRateLimiter()

    router.post('/register', authRateLimiter, registerUser)
    router.post('/login', authRateLimiter, loginUser)
    router.post('/refresh', refreshAccessToken)
    router.post('/logout', logoutUser)
    router.post('/logout-all', protect, logoutAllSessions)
    router.post('/password-reset/request', authRateLimiter, requestPasswordReset)
    router.post('/password-reset/confirm', authRateLimiter, confirmPasswordReset)
    router.get('/user', protect, getUserInfo)
    router.patch('/user', protect, updateUserPreferences)

    return router
}

export default createAuthRoutes()
