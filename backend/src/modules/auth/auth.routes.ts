import express from 'express'
import { authenticateOnly, optionalAuthenticate } from '@http/middleware/authMiddleware'
import { createAuthRateLimiter } from '@http/middleware/rateLimitMiddleware'
import {
    registerUser,
    loginUser,
    refreshAccessToken,
    logoutUser,
    logoutAllSessions,
    requestPasswordReset,
    confirmPasswordReset,
    confirmEmailVerification,
    resendEmailVerification,
} from './auth.controller'

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

    router.post('/register', registerRateLimiter, registerUser)
    router.post('/login', authRateLimiter, loginUser)
    router.post('/refresh', sessionRateLimiter, refreshAccessToken)
    router.post('/logout', sessionRateLimiter, logoutUser)
    router.post('/logout-all', authenticateOnly, logoutAllSessions)
    router.post('/password-reset/request', passwordResetRateLimiter, requestPasswordReset)
    router.post('/password-reset/confirm', passwordResetRateLimiter, confirmPasswordReset)
    router.post('/email-verification/confirm', verificationRateLimiter, confirmEmailVerification)
    // `optionalAuthenticate`: the signed-in verify screen calls this with a token, but a
    // returning unverified user is blocked at login (no token) and resends by email instead.
    router.post('/email-verification/resend', verificationRateLimiter, optionalAuthenticate, resendEmailVerification)

    return router
}

export default createAuthRoutes()
