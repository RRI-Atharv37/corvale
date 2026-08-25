import express from 'express'
import { protect, authenticateOnly } from '../middleware/authMiddleware'
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
    confirmEmailVerification,
    resendEmailVerification,
    updateUserPreferences,
    deleteUserAccount,
} from '../controllers/authController'

export const createAuthRoutes = (): express.Router => {
    const router = express.Router()
    const authRateLimiter = createAuthRateLimiter('auth-login')
    // Own instance so a bulk-registration burst can't also lock a legitimate user out of
    // login, and vice versa (SEC-26/L9).
    const registerRateLimiter = createAuthRateLimiter('auth-register')
    // Separate instance (not shared with register/login) so a burst of refresh/logout
    // replay attempts can't also lock a legitimate user out of signing in (SEC-26).
    const sessionRateLimiter = createAuthRateLimiter('auth-session')
    // Password reset now sends a real email (S7), giving it a real abuse cost — its own
    // instance keeps a reset-spam burst from also locking a legitimate user out of login.
    const passwordResetRateLimiter = createAuthRateLimiter('auth-password-reset')
    // Same reasoning for email verification (resend/confirm).
    const verificationRateLimiter = createAuthRateLimiter('auth-verification')
    // Account deletion re-checks the password like login does, so it gets the same
    // brute-force protection, on its own instance so it can't lock a user out of login.
    const accountDeletionRateLimiter = createAuthRateLimiter('auth-account-deletion')

    router.post('/register', registerRateLimiter, registerUser)
    router.post('/login', authRateLimiter, loginUser)
    router.post('/refresh', sessionRateLimiter, refreshAccessToken)
    router.post('/logout', sessionRateLimiter, logoutUser)
    router.post('/logout-all', authenticateOnly, logoutAllSessions)
    router.post('/password-reset/request', passwordResetRateLimiter, requestPasswordReset)
    router.post('/password-reset/confirm', passwordResetRateLimiter, confirmPasswordReset)
    router.post('/email-verification/confirm', verificationRateLimiter, confirmEmailVerification)
    router.post('/email-verification/resend', verificationRateLimiter, authenticateOnly, resendEmailVerification)
    router.get('/user', authenticateOnly, getUserInfo)
    router.patch('/user', protect, updateUserPreferences)
    router.delete('/account', accountDeletionRateLimiter, authenticateOnly, deleteUserAccount)

    return router
}

export default createAuthRoutes()
