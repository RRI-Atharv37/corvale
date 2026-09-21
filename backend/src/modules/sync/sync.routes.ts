import express from 'express'

import { getSyncBootstrap, getSyncPull, pushSyncOps } from './sync.controller'
import { protect } from '@http/middleware/authMiddleware'
import { requireScopedWriteAccess } from '@modules/billing/entitlement.middleware'
import { scopeFromBody } from '@modules/billing/billingScope'
import { requireSyncPushDevice, trackSyncDevice, trackSyncPushDevice } from '@modules/billing/syncDevice.middleware'
import { createSyncPushRateLimiter } from '@http/middleware/rateLimitMiddleware'

export const createSyncRoutes = (): express.Router => {
    const router = express.Router()
    const syncPushRateLimiter = createSyncPushRateLimiter()

    router.get('/bootstrap', protect, trackSyncDevice, getSyncBootstrap)
    router.get('/pull', protect, trackSyncDevice, getSyncPull)
    router.post(
        '/push',
        protect,
        syncPushRateLimiter,
        trackSyncPushDevice,
        requireScopedWriteAccess(scopeFromBody),
        requireSyncPushDevice,
        pushSyncOps
    )

    return router
}

export default createSyncRoutes()
