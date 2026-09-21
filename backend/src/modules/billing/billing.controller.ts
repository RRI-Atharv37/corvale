import type { Request, Response } from 'express'
import asyncHandler from 'express-async-handler'

import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'
import type { AuthRequest } from '@http/middleware/authTypes'

import {
    getBillingOverview,
    getPublicPlans,
    getSyncDevices,
    listInvoices,
    openPortal,
    parsePlanSelection,
    requestCancellation,
    requestPlanChange,
    requestResume,
    startCheckout,
} from './billing.service'
import { renameSyncDevice, revokeSyncDevice } from './syncDevice.service'

const REQUESTED = { requested: true }

export const getPlans = asyncHandler(async (_req: Request, res: Response) => {
    handleResponses(res, 200, await getPublicPlans())
})

export const getOverview = asyncHandler(async (req: AuthRequest, res: Response) => {
    handleResponses(res, 200, await getBillingOverview(getUserId(req)))
})

export const createCheckout = asyncHandler(async (req: AuthRequest, res: Response) => {
    const selection = parsePlanSelection(req.body)
    handleResponses(res, 200, await startCheckout(getUserId(req), selection))
})

export const createPortal = asyncHandler(async (req: AuthRequest, res: Response) => {
    handleResponses(res, 200, await openPortal(getUserId(req)))
})

export const changePlan = asyncHandler(async (req: AuthRequest, res: Response) => {
    const selection = parsePlanSelection(req.body)
    await requestPlanChange(getUserId(req), selection)
    handleResponses(res, 202, REQUESTED)
})

export const cancelSubscription = asyncHandler(async (req: AuthRequest, res: Response) => {
    await requestCancellation(getUserId(req))
    handleResponses(res, 202, REQUESTED)
})

export const resumeSubscription = asyncHandler(async (req: AuthRequest, res: Response) => {
    await requestResume(getUserId(req))
    handleResponses(res, 202, REQUESTED)
})

export const getInvoices = asyncHandler(async (req: AuthRequest, res: Response) => {
    handleResponses(res, 200, { invoices: await listInvoices(getUserId(req)) })
})

export const getDevices = asyncHandler(async (req: AuthRequest, res: Response) => {
    handleResponses(res, 200, await getSyncDevices(getUserId(req), req.query.deviceId))
})

export const renameDevice = asyncHandler(async (req: AuthRequest, res: Response) => {
    const name = await renameSyncDevice(getUserId(req), req.params.deviceId, (req.body as { name?: unknown } | undefined)?.name)
    handleResponses(res, 200, { deviceId: req.params.deviceId, name })
})

export const revokeDevice = asyncHandler(async (req: AuthRequest, res: Response) => {
    await revokeSyncDevice(getUserId(req), req.params.deviceId)
    handleResponses(res, 200, { deviceId: req.params.deviceId })
})
