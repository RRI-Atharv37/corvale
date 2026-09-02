import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import { AuthRequest } from '@http/middleware/authTypes'
import { DEFAULT_TIMEZONE } from '@core/time/timezoneUtils'
import {
    computeBudgetAnalysis,
    computeCrossoverPoint,
    computeIncomeVsExpense,
    computeLargestExpenses,
    computePeriodAverages,
    computeRecurringTotals,
    computeSavingsRate,
    computeSpendingAnalysis,
    computeSpendingTrends,
    executeCustomReportQuery,
    generateCustomReport,
    parseCustomReportChartType,
    parseCustomReportDataType,
    parseCustomReportSplitBy,
    parseReportMetrics,
    resolveReportPeriod,
} from './reportUtils'
import { parseOptionalWorkspaceId } from '@core/access/workspace'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'
import { parseDashboardGroupBy } from "@modules/dashboard/dashboardUtils";
import { parseExportFormat, sendCustomReportExport, type ExportFormat } from "@modules/transactions/export";
import { assertWorkspaceMembership } from "@modules/workspaces/access";

const getUserTimezone = (req: AuthRequest): string => {
    return req.user?.timezone?.trim() || DEFAULT_TIMEZONE
}

const resolveListWorkspaceId = async (req: AuthRequest): Promise<string | null> => {
    const userId = getUserId(req)
    const workspaceId =
        parseOptionalWorkspaceId(req.query.workspaceId ?? req.body?.workspaceId) ?? null

    if (workspaceId) {
        await assertWorkspaceMembership(workspaceId, userId, 'viewer')
    }

    return workspaceId
}

export const getReportAverages = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const workspaceId = await resolveListWorkspaceId(req)
    const period = resolveReportPeriod(req.query, timezone)
    const averages = await computePeriodAverages(userId, period, timezone, workspaceId)
    handleResponses(res, 200, averages)
})

export const getLargestExpenses = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const workspaceId = await resolveListWorkspaceId(req)
    const period = resolveReportPeriod(req.query, timezone)
    const limit = Number(req.query.limit ?? 10)
    const expenses = await computeLargestExpenses(
        userId,
        period.periodStart,
        period.periodEnd,
        Number.isNaN(limit) ? 10 : limit,
        workspaceId
    )
    handleResponses(res, 200, {
        periodStart: period.startDate,
        periodEnd: period.endDate,
        expenses,
    })
})

export const getSpendingTrends = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const workspaceId = await resolveListWorkspaceId(req)
    const period = resolveReportPeriod(req.query, timezone)
    const trends = await computeSpendingTrends(userId, period, timezone, workspaceId)
    handleResponses(res, 200, {
        periodStart: period.startDate,
        periodEnd: period.endDate,
        trends,
    })
})

export const getIncomeVsExpense = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const workspaceId = await resolveListWorkspaceId(req)
    const period = resolveReportPeriod(req.query, timezone)
    const comparison = await computeIncomeVsExpense(userId, period, workspaceId)
    handleResponses(res, 200, {
        periodStart: period.startDate,
        periodEnd: period.endDate,
        ...comparison,
    })
})

export const getSavingsRate = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const workspaceId = await resolveListWorkspaceId(req)
    const period = resolveReportPeriod(req.query, timezone)
    const savingsRate = await computeSavingsRate(userId, period, workspaceId)
    handleResponses(res, 200, savingsRate)
})

export const getRecurringTotals = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const workspaceId = await resolveListWorkspaceId(req)
    const period = resolveReportPeriod(req.query, timezone)
    const totals = await computeRecurringTotals(userId, period, workspaceId)
    handleResponses(res, 200, totals)
})

export const getBudgetAnalysis = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const workspaceId = await resolveListWorkspaceId(req)
    const period = resolveReportPeriod(req.query, timezone)
    const analysis = await computeBudgetAnalysis(userId, period, timezone, workspaceId)
    handleResponses(res, 200, analysis)
})

export const getSpendingAnalysis = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const workspaceId = await resolveListWorkspaceId(req)
    const period = resolveReportPeriod(req.query, timezone)
    const limit = Number(req.query.limit ?? 10)
    const analysis = await computeSpendingAnalysis(
        userId,
        period,
        timezone,
        Number.isNaN(limit) ? 10 : limit,
        workspaceId
    )
    handleResponses(res, 200, analysis)
})

export const getCrossoverPoint = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const workspaceId = await resolveListWorkspaceId(req)
    const period = resolveReportPeriod(req.query, timezone)
    const crossover = await computeCrossoverPoint(userId, period, timezone, workspaceId)
    handleResponses(res, 200, crossover)
})

export const queryCustomReport = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const workspaceId = await resolveListWorkspaceId(req)
    const period = resolveReportPeriod({ ...req.query, ...req.body }, timezone)
    const splitBy = parseCustomReportSplitBy(req.body.splitBy ?? req.query.splitBy)
    const chartType = parseCustomReportChartType(req.body.chartType ?? req.query.chartType)
    const dataType = parseCustomReportDataType(req.body.dataType ?? req.query.dataType ?? 'expense')
    const groupBy = parseDashboardGroupBy(req.body.groupBy ?? req.query.groupBy ?? 'month')

    const result = await executeCustomReportQuery(userId, period, {
        splitBy,
        chartType,
        dataType,
        groupBy,
        timezone,
        workspaceId,
    })

    handleResponses(res, 200, result)
})

export const generateReport = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const workspaceId = await resolveListWorkspaceId(req)
    const period = resolveReportPeriod({ ...req.query, ...req.body }, timezone)
    const metrics = parseReportMetrics(req.body.metrics ?? req.query.metrics)
    const limit = Number(req.body.limit ?? req.query.limit ?? 10)

    const report = await generateCustomReport(
        userId,
        period,
        metrics,
        timezone,
        Number.isNaN(limit) ? 10 : limit,
        workspaceId
    )

    const formatParam =
        typeof req.body.format === 'string'
            ? req.body.format
            : typeof req.query.format === 'string'
              ? req.query.format
              : undefined

    if (formatParam !== undefined) {
        const format = parseExportFormat(formatParam) as ExportFormat
        sendCustomReportExport(
            res,
            format,
            `corvale-report-${period.startDate}-${period.endDate}`,
            report
        )
        return
    }

    handleResponses(res, 200, report)
})
