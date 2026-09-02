import express from 'express'
import { protect, authenticateOnly, optionalAuthenticate } from '@http/middleware/authMiddleware'
import { createAuthRateLimiter } from '@http/middleware/rateLimitMiddleware'
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
    getAccountDeletionImpact,
    deleteUserAccount,
    acceptLegalTerms,
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
    // `optionalAuthenticate`: the signed-in verify screen calls this with a token, but a
    // returning unverified user is blocked at login (no token) and resends by email instead.
    router.post('/email-verification/resend', verificationRateLimiter, optionalAuthenticate, resendEmailVerification)
    router.get('/user', authenticateOnly, getUserInfo)
    router.patch('/user', protect, updateUserPreferences)
    // Re-accept the current Terms/Privacy versions. `authenticateOnly` rather than `protect`:
    // the gate must be clearable by a user whose email is not verified yet, or they would be
    // stuck behind two blocking prompts at once.
    router.post('/legal/accept', authenticateOnly, acceptLegalTerms)
    // Read-only preview ahead of the irreversible delete below - same authenticateOnly gate
    // (reachable even with an unverified email, matching the delete endpoint it previews), no
    // rate limiter of its own since it never touches the password/brute-force surface.
    router.get('/account/deletion-impact', authenticateOnly, getAccountDeletionImpact)
    router.delete('/account', accountDeletionRateLimiter, authenticateOnly, deleteUserAccount)

    return router
}

export default createAuthRoutes()
