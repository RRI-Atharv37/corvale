import type { Response } from 'express'
import asyncHandler from 'express-async-handler'

import { handleResponses } from '@core/http/response'

import { requestContext, type AdminRequest } from './adminAuth.middleware'
import {
    applyResync,
    cancelAtPeriodEnd,
    cancelNow,
    listSubscriberInvoices,
    previewResync,
    recomputeUsage,
    refundInvoice,
    replayEvent,
    revokeDevice,
} from './adminBilling.service'
import type { AdminPrincipal } from './adminTypes'

const principalOf = (req: AdminRequest): AdminPrincipal => req.admin as AdminPrincipal

export const invoices = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await listSubscriberInvoices(req.params.userId))
})

export const refund = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 202, await refundInvoice(principalOf(req), req.params.userId, req.body ?? {}, requestContext(req)))
})

export const cancelSubscriptionAtPeriodEnd = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 202, await cancelAtPeriodEnd(principalOf(req), req.params.userId, req.body ?? {}, requestContext(req)))
})

export const cancelSubscriptionNow = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 202, await cancelNow(principalOf(req), req.params.userId, req.body ?? {}, requestContext(req)))
})

export const resyncPreview = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await previewResync(req.params.userId))
})

export const resyncApply = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await applyResync(principalOf(req), req.params.userId, req.body ?? {}, requestContext(req)))
})

export const recomputeSubscriberUsage = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await recomputeUsage(principalOf(req), req.params.userId, req.body ?? {}, requestContext(req)))
})

export const revokeSubscriberDevice = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await revokeDevice(principalOf(req), req.params.userId, req.params.deviceRef, req.body ?? {}, requestContext(req)))
})

export const replayBillingEventAction = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await replayEvent(principalOf(req), req.params.eventId, req.body ?? {}, requestContext(req)))
})
