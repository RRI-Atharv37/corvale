import type { Response } from 'express'
import asyncHandler from 'express-async-handler'

import { handleResponses } from '@core/http/response'

import { getGrandfatherCohortReport } from './adminGrandfatherReport.service'
import { getMetricsOverview } from './adminMetrics.service'
import type { AdminRequest } from './adminAuth.middleware'

export const metricsOverview = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await getMetricsOverview(req.query))
})

export const grandfatherCohortReport = asyncHandler(async (_req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await getGrandfatherCohortReport())
})
