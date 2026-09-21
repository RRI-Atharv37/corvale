import type { Response } from 'express'
import asyncHandler from 'express-async-handler'

import { handleResponses } from '@core/http/response'

import { requestContext, type AdminRequest } from './adminAuth.middleware'
import { applyGrant, clearErasureHold, extendTrial, revokeGrant, setErasureHold } from './adminGrants.service'
import type { AdminPrincipal } from './adminTypes'

const principalOf = (req: AdminRequest): AdminPrincipal => req.admin as AdminPrincipal

export const grant = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await applyGrant(principalOf(req), req.params.userId, req.body ?? {}, requestContext(req)))
})

export const revoke = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await revokeGrant(principalOf(req), req.params.userId, req.body ?? {}, requestContext(req)))
})

export const trialExtension = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await extendTrial(principalOf(req), req.params.userId, req.body ?? {}, requestContext(req)))
})

export const erasureHold = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await setErasureHold(principalOf(req), req.params.userId, req.body ?? {}, requestContext(req)))
})

export const erasureHoldClear = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await clearErasureHold(principalOf(req), req.params.userId, req.body ?? {}, requestContext(req)))
})
