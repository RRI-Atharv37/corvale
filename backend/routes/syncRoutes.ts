import express from 'express'

import { getSyncBootstrap, getSyncPull, pushSyncOps } from '../controllers/syncController'
import { protect } from '@http/middleware/authMiddleware'
import { createSyncPushRateLimiter } from '@http/middleware/rateLimitMiddleware'

export const createSyncRoutes = (): express.Router => {
    const router = express.Router()
    const syncPushRateLimiter = createSyncPushRateLimiter()

    router.get('/bootstrap', protect, getSyncBootstrap)
    router.get('/pull', protect, getSyncPull)
    router.post('/push', protect, syncPushRateLimiter, pushSyncOps)

    return router
}

export default createSyncRoutes()
