import express from 'express'

import { protect, authenticateOnly } from '@http/middleware/authMiddleware'
import { createAuthRateLimiter } from '@http/middleware/rateLimitMiddleware'
import {
    getUserInfo,
    updateUserPreferences,
    acceptLegalTerms,
    getAccountDeletionImpact,
    deleteUserAccount,
} from './user.controller'

/**
 * User-account routes. Mounted by the auth module under `/api/v1/auth` (`auth.routes.ts`), so
 * the paths below stay `/auth/user`, `/auth/legal/accept`, `/auth/account/*` — RF3 moved no URL.
 */
export const createUserRoutes = (): express.Router => {
    const router = express.Router()

    // Account deletion re-checks the password like login does, so it gets the same
    // brute-force protection, on its own instance so it can't lock a user out of login.
    const accountDeletionRateLimiter = createAuthRateLimiter('auth-account-deletion')

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

export default createUserRoutes()
