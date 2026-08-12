import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import { AuthRequest } from '../middleware/authTypes'
import { DEFAULT_TIMEZONE } from '../utils/timezoneUtils'
import {
    computeCashFlowSeries,
    computeCategoryBreakdown,
    computeDashboardSummary,
    computeBudgetOverview,
    computeNetWorthTrend,
    resolveDashboardQuery,
} from '../utils/dashboardUtils'
import { getUserId, handleResponses } from '../utils/sharedUtils'

const getUserTimezone = (req: AuthRequest): string => {
    return req.user?.timezone?.trim() || DEFAULT_TIMEZONE
}

export const getDashboardSummary = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const { periodStart, periodEnd, startDate, endDate } = resolveDashboardQuery(req.query, timezone)

    const summary = await computeDashboardSummary(userId, periodStart, periodEnd, startDate, endDate)
    handleResponses(res, 200, summary)
})

export const getDashboardCashFlow = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const { periodStart, periodEnd, startDate, endDate, groupBy } = resolveDashboardQuery(
        req.query,
        timezone
    )

    const series = await computeCashFlowSeries(
        userId,
        periodStart,
        periodEnd,
        startDate,
        endDate,
        groupBy,
        timezone
    )

    handleResponses(res, 200, {
        groupBy,
        periodStart: startDate,
        periodEnd: endDate,
        series,
    })
})

export const getDashboardCategoryBreakdown = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const { periodStart, periodEnd } = resolveDashboardQuery(req.query, timezone)

    const type = req.query.type === 'income' ? 'income' : 'expense'
    const breakdown = await computeCategoryBreakdown(userId, periodStart, periodEnd, type)

    handleResponses(res, 200, {
        type,
        breakdown,
    })
})

export const getNetWorthTrend = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const { periodStart, periodEnd, startDate, endDate } = resolveDashboardQuery(req.query, timezone)

    const trend = await computeNetWorthTrend(
        userId,
        periodStart,
        periodEnd,
        startDate,
        endDate,
        timezone
    )
    handleResponses(res, 200, trend)
})

export const getBudgetOverview = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const overview = await computeBudgetOverview(userId, timezone)
    handleResponses(res, 200, overview)
})
