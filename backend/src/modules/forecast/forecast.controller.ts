import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import { AuthRequest } from '@http/middleware/authTypes'
import { CustomError } from '@core/errors/customError'
import { buildForecast } from './forecast.service'
import { parseOptionalWorkspaceId } from '@core/access/workspace'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'

const SUPPORTED_DAYS = [30, 60, 90]

const parseDays = (value: unknown): number => {
    if (value === undefined) {
        return 30
    }
    const days = Number(value)
    if (!SUPPORTED_DAYS.includes(days)) {
        throw new CustomError(`Invalid days; must be one of ${SUPPORTED_DAYS.join(', ')}`, 400)
    }
    return days
}

export const getForecast = asyncHandler(async (req: AuthRequest, res: Response) => {
    const forecast = await buildForecast({
        userId: getUserId(req),
        days: parseDays(req.query.days),
        workspaceId: parseOptionalWorkspaceId(req.query.workspaceId) ?? null,
        accountId: req.query.accountId ? String(req.query.accountId) : undefined,
    })

    handleResponses(res, 200, forecast)
})
