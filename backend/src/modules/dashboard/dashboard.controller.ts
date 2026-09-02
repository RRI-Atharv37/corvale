import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import { AuthRequest } from '@http/middleware/authTypes'
import { DEFAULT_TIMEZONE } from '@core/time/timezoneUtils'
import {
    computeCashFlowSeries,
    computeCategoryBreakdown,
    computeDashboardSummary,
    computeBudgetOverview,
    computeNetWorthTrend,
    resolveDashboardQuery,
} from './dashboardUtils'
import { parseOptionalWorkspaceId } from '@core/access/workspace'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'
import { computeUserBalances } from "@modules/accounts/accountBalance";
import { assertWorkspaceMembership } from "@modules/workspaces/access";

const getUserTimezone = (req: AuthRequest): string => {
    return req.user?.timezone?.trim() || DEFAULT_TIMEZONE
}

const resolveListWorkspaceId = async (req: AuthRequest): Promise<string | null> => {
    const userId = getUserId(req)
    const workspaceId = parseOptionalWorkspaceId(req.query.workspaceId) ?? null

    if (workspaceId) {
        await assertWorkspaceMembership(workspaceId, userId, 'viewer')
    }

    return workspaceId
}

export const getDashboardSummary = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const workspaceId = await resolveListWorkspaceId(req)
    const { periodStart, periodEnd, startDate, endDate } = resolveDashboardQuery(req.query, timezone)

    const summary = await computeDashboardSummary(
        userId,
        periodStart,
        periodEnd,
        startDate,
        endDate,
        workspaceId,
        {
            preferredCurrency: req.user!.preferredCurrency,
            exchangeRates: req.user!.exchangeRates ?? {},
        }
    )
    handleResponses(res, 200, summary)
})

export const getDashboardOverview = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const workspaceId = await resolveListWorkspaceId(req)
    const preferredCurrency = req.user!.preferredCurrency
    const exchangeRates = req.user!.exchangeRates ?? {}

    const balances = await computeUserBalances(userId, workspaceId, {
        preferredCurrency,
        exchangeRates,
    })

    handleResponses(res, 200, {
        netWorth: balances.netWorth,
        netWorthInPreferredCurrency: balances.netWorth,
        preferredCurrency,
        totalAccountBalance: balances.totalAccountBalance,
        liquidBalance: balances.liquidBalance,
        spendableBalance: balances.spendableBalance,
        accountCount: balances.accountCount,
        balanceSource: balances.balanceSource,
    })
})

export const getDashboardCashFlow = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const workspaceId = await resolveListWorkspaceId(req)
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
        timezone,
        workspaceId
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
    const workspaceId = await resolveListWorkspaceId(req)
    const { periodStart, periodEnd } = resolveDashboardQuery(req.query, timezone)

    const type = req.query.type === 'income' ? 'income' : 'expense'
    const breakdown = await computeCategoryBreakdown(
        userId,
        periodStart,
        periodEnd,
        type,
        workspaceId
    )

    handleResponses(res, 200, {
        type,
        breakdown,
    })
})

export const getNetWorthTrend = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const workspaceId = await resolveListWorkspaceId(req)
    const { periodStart, periodEnd, startDate, endDate } = resolveDashboardQuery(req.query, timezone)

    const trend = await computeNetWorthTrend(
        userId,
        periodStart,
        periodEnd,
        startDate,
        endDate,
        timezone,
        workspaceId
    )
    handleResponses(res, 200, trend)
})

export const getBudgetOverview = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const workspaceId = await resolveListWorkspaceId(req)
    const overview = await computeBudgetOverview(userId, timezone, workspaceId)
    handleResponses(res, 200, overview)
})
