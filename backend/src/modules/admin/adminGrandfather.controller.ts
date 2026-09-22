import type { Response } from 'express'
import asyncHandler from 'express-async-handler'

import { handleResponses } from '@core/http/response'

import { requestContext, type AdminRequest } from './adminAuth.middleware'
import {
    applyGrandfatherCohort,
    listGrandfatherBatches,
    previewGrandfatherCohort,
    revertGrandfatherCohort,
    revokeGrandfather,
    setGrandfather,
} from './adminGrandfather.service'
import type { AdminPrincipal } from './adminTypes'

const principalOf = (req: AdminRequest): AdminPrincipal => req.admin as AdminPrincipal

export const grandfather = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await setGrandfather(principalOf(req), req.params.userId, req.body ?? {}, requestContext(req)))
})

export const grandfatherRevoke = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await revokeGrandfather(principalOf(req), req.params.userId, req.body ?? {}, requestContext(req)))
})

export const cohortDryRun = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await previewGrandfatherCohort(req.body ?? {}))
})

export const cohortApply = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await applyGrandfatherCohort(principalOf(req), req.body ?? {}, requestContext(req)))
})

export const cohortBatches = asyncHandler(async (_req: AdminRequest, res: Response) => {
    handleResponses(res, 200, { batches: await listGrandfatherBatches() })
})

export const cohortRevert = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await revertGrandfatherCohort(principalOf(req), req.params.batchId, req.body ?? {}, requestContext(req)))
})
