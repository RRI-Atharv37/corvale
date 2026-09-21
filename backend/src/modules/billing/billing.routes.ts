import express from 'express'

import { protect } from '@http/middleware/authMiddleware'

import {
    cancelSubscription,
    changePlan,
    createCheckout,
    createPortal,
    getDevices,
    getInvoices,
    getOverview,
    getPlans,
    renameDevice,
    resumeSubscription,
    revokeDevice,
} from './billing.controller'

// Every route here is deliberately outside the read-only write gate: a lapsed user must always be
// able to pay, fetch a receipt or cancel. None of them changes entitlement - that only ever happens
// on a signed webhook (webhook.routes.ts, mounted from app.ts ahead of express.json).
const router = express.Router()

router.get('/plans', getPlans)
router.get('/overview', protect, getOverview)
router.get('/invoices', protect, getInvoices)
router.post('/checkout', protect, createCheckout)
router.post('/portal', protect, createPortal)
router.post('/change-plan', protect, changePlan)
router.post('/cancel', protect, cancelSubscription)
router.post('/resume', protect, resumeSubscription)
router.get('/devices', protect, getDevices)
router.patch('/devices/:deviceId', protect, renameDevice)
router.delete('/devices/:deviceId', protect, revokeDevice)

export default router
