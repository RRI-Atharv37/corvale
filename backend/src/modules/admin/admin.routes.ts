import express from 'express'

import { isFinanceOpsEnabled } from '@modules/billing'

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
import { cohortApply, cohortBatches, cohortDryRun, cohortRevert, grandfather, grandfatherRevoke } from './adminGrandfather.controller'
import {
    cancelSubscriptionAtPeriodEnd,
    cancelSubscriptionNow,
    invoices,
    recomputeSubscriberUsage,
    refund,
    replayBillingEventAction,
    resyncApply,
    resyncPreview,
    revokeSubscriberDevice,
} from './adminBilling.controller'
import { grandfatherCohortReport, metricsOverview } from './adminMetrics.controller'
import {
    fyRevenueSummary,
    payoutReconciliationSummary,
    recognitionExportCsv,
    recognitionRun,
    recognitionSummary,
    recordPayout,
    updatePayout,
} from './adminFinance.controller'

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

    router.post('/subscribers/:userId/grandfather', protectAdmin, requireCapability('grandfather.write'), grandfather)
    router.post('/subscribers/:userId/grandfather/revoke', protectAdmin, requireCapability('grandfather.write'), grandfatherRevoke)
    router.post('/grandfather/cohort/dry-run', protectAdmin, requireCapability('grandfather.write'), cohortDryRun)
    router.post('/grandfather/cohort/apply', protectAdmin, requireCapability('grandfather.write'), requireStepUp, cohortApply)
    router.get('/grandfather/cohort/batches', protectAdmin, requireCapability('grandfather.write'), cohortBatches)
    router.post('/grandfather/cohort/:batchId/revert', protectAdmin, requireCapability('grandfather.write'), requireStepUp, cohortRevert)

    router.get('/subscribers/:userId/invoices', protectAdmin, requireCapability('money.write'), invoices)
    router.post('/subscribers/:userId/refund', protectAdmin, requireCapability('money.write'), requireStepUp, refund)
    router.post('/subscribers/:userId/cancel', protectAdmin, requireCapability('money.write'), cancelSubscriptionAtPeriodEnd)
    router.post('/subscribers/:userId/cancel/now', protectAdmin, requireCapability('money.write'), requireStepUp, cancelSubscriptionNow)
    router.get('/subscribers/:userId/resync/preview', protectAdmin, requireCapability('money.write'), resyncPreview)
    router.post('/subscribers/:userId/resync/apply', protectAdmin, requireCapability('money.write'), resyncApply)
    router.post('/subscribers/:userId/recompute-usage', protectAdmin, requireCapability('grants.write'), recomputeSubscriberUsage)
    router.post('/subscribers/:userId/devices/:deviceRef/revoke', protectAdmin, requireCapability('grants.write'), revokeSubscriberDevice)
    router.post('/billing-events/:eventId/replay', protectAdmin, requireCapability('money.write'), requireStepUp, replayBillingEventAction)

    router.get('/metrics/overview', protectAdmin, requireCapability('metrics.read'), metricsOverview)
    router.get('/metrics/grandfather-cohort', protectAdmin, requireCapability('metrics.read'), grandfatherCohortReport)

    // M8e/M8f/M8g: the finance bookkeeping surface exists only where an operator has deliberately switched it on.
    if (isFinanceOpsEnabled()) {
        router.get('/finance/recognition/summary', protectAdmin, requireCapability('metrics.read'), recognitionSummary)
        router.get('/finance/recognition/export.csv', protectAdmin, requireCapability('metrics.read'), recognitionExportCsv)
        router.post('/finance/recognition/run', protectAdmin, requireCapability('money.write'), recognitionRun)

        router.get('/finance/payouts', protectAdmin, requireCapability('metrics.read'), payoutReconciliationSummary)
        router.post('/finance/payouts', protectAdmin, requireCapability('money.write'), recordPayout)
        router.patch('/finance/payouts/:payoutId', protectAdmin, requireCapability('money.write'), updatePayout)

        router.get('/finance/fy-revenue', protectAdmin, requireCapability('metrics.read'), fyRevenueSummary)
    }

    return router
}
