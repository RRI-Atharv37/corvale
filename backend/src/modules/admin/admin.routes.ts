import express from 'express'

import { adminIpAllowlist, protectAdmin, requireCapability, requireStepUp } from './adminAuth.middleware'
import {
    createAdminEnrolRateLimiter,
    createAdminLoginRateLimiter,
    createAdminSessionRateLimiter,
} from './adminRateLimit'
import { enrolComplete, enrolStart, login, logout, me, refresh, stepUp } from './adminAuth.controller'
import { auditLog, invite, list, resetTotp, setStatus } from './adminManagement.controller'
import { detail, list as listSubscribers, lookup, meta, opsHealth } from './adminSubscribers.controller'
import { erasureHold, erasureHoldClear, grant, revoke, trialExtension } from './adminGrants.controller'

/**
 * Mounted by `http/routes.ts` only while ADMIN_ENABLED=true. Everything sits behind the optional IP
 * allowlist; only login, refresh, logout and enrolment are reachable without an admin access token.
 */
export const createAdminRoutes = (): express.Router => {
    const router = express.Router()
    const loginLimiter = createAdminLoginRateLimiter()
    const enrolLimiter = createAdminEnrolRateLimiter()
    const sessionLimiter = createAdminSessionRateLimiter()

    router.use(adminIpAllowlist)

    router.post('/auth/login', loginLimiter, login)
    router.post('/auth/refresh', sessionLimiter, refresh)
    router.post('/auth/logout', sessionLimiter, logout)
    router.post('/auth/enrol/start', enrolLimiter, enrolStart)
    router.post('/auth/enrol/complete', enrolLimiter, enrolComplete)
    router.post('/auth/step-up', sessionLimiter, protectAdmin, stepUp)
    router.get('/auth/me', protectAdmin, me)

    router.get('/admins', protectAdmin, requireCapability('admins.manage'), list)
    router.post('/admins/invite', protectAdmin, requireCapability('admins.manage'), requireStepUp, invite)
    router.post('/admins/:adminId/reset-totp', protectAdmin, requireCapability('admins.manage'), requireStepUp, resetTotp)
    router.patch('/admins/:adminId', protectAdmin, requireCapability('admins.manage'), requireStepUp, setStatus)
    router.get('/audit', protectAdmin, requireCapability('audit.read'), auditLog)

    router.get('/meta', protectAdmin, meta)
    router.get('/subscribers/lookup', protectAdmin, requireCapability('subscribers.read'), lookup)
    router.get('/subscribers', protectAdmin, requireCapability('subscribers.read'), listSubscribers)
    router.get('/subscribers/:userId', protectAdmin, requireCapability('subscribers.read'), detail)
    router.get('/ops/health', protectAdmin, requireCapability('ops.read'), opsHealth)

    router.post('/subscribers/:userId/grant', protectAdmin, requireCapability('grants.write'), grant)
    router.post('/subscribers/:userId/grant/revoke', protectAdmin, requireCapability('grants.write'), revoke)
    router.post('/subscribers/:userId/trial-extension', protectAdmin, requireCapability('grants.write'), trialExtension)
    router.post('/subscribers/:userId/erasure-hold', protectAdmin, requireCapability('grants.write'), erasureHold)
    router.post('/subscribers/:userId/erasure-hold/clear', protectAdmin, requireCapability('grants.write'), erasureHoldClear)

    return router
}
