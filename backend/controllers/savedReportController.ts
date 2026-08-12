import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import SavedReport, { ISavedReportConfig } from '../models/SavedReport'
import { AuthRequest } from '../middleware/authTypes'
import { parseDashboardGroupBy } from '../utils/dashboardUtils'
import { CustomError } from '../utils/customError'
import {
    executeCustomReportQuery,
    parseCustomReportChartType,
    parseCustomReportDataType,
    parseCustomReportSplitBy,
    parseReportPeriodType,
    resolveReportPeriod,
} from '../utils/reportUtils'
import { DEFAULT_TIMEZONE } from '../utils/timezoneUtils'
import {
    getUserId,
    handleResponses,
    validateOwnership,
    validateRequiredFields,
} from '../utils/sharedUtils'

const getUserTimezone = (req: AuthRequest): string => {
    return req.user?.timezone?.trim() || DEFAULT_TIMEZONE
}

const parseSavedReportConfig = (body: Record<string, unknown>): ISavedReportConfig => {
    validateRequiredFields(body, ['periodType', 'splitBy', 'chartType', 'dataType'])

    const periodType = parseReportPeriodType(body.periodType)
    const config: ISavedReportConfig = {
        periodType,
        splitBy: parseCustomReportSplitBy(body.splitBy),
        chartType: parseCustomReportChartType(body.chartType),
        dataType: parseCustomReportDataType(body.dataType),
    }

    if (periodType === 'monthly') {
        validateRequiredFields(body, ['year', 'month'])
        config.year = Number(body.year)
        config.month = Number(body.month)
    } else if (periodType === 'yearly') {
        validateRequiredFields(body, ['year'])
        config.year = Number(body.year)
    } else {
        validateRequiredFields(body, ['startDate', 'endDate'])
        config.startDate = String(body.startDate)
        config.endDate = String(body.endDate)
    }

    if (body.groupBy !== undefined) {
        config.groupBy = parseDashboardGroupBy(body.groupBy)
    }

    return config
}

const configToPeriodQuery = (config: ISavedReportConfig): Record<string, unknown> => {
    if (config.periodType === 'monthly') {
        return { periodType: config.periodType, year: config.year, month: config.month }
    }
    if (config.periodType === 'yearly') {
        return { periodType: config.periodType, year: config.year }
    }
    return {
        periodType: config.periodType,
        startDate: config.startDate,
        endDate: config.endDate,
    }
}

export const listSavedReports = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const reports = await SavedReport.find({ userId }).sort({ updatedAt: -1 })
    handleResponses(res, 200, reports)
})

export const createSavedReport = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    validateRequiredFields(req.body, ['name'])

    const name = String(req.body.name).trim()
    if (!name) {
        throw new CustomError('Report name is required', 400)
    }

    const config = parseSavedReportConfig(req.body)
    const report = await SavedReport.create({ userId, name, config })
    handleResponses(res, 201, report)
})

export const updateSavedReport = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { reportId } = req.params

    validateRequiredFields({ reportId }, ['reportId'])

    const report = await validateOwnership(
        SavedReport,
        reportId,
        userId,
        'Saved report not found'
    )

    if (typeof req.body.name === 'string' && req.body.name.trim()) {
        report.name = req.body.name.trim()
    }

    if (req.body.periodType !== undefined) {
        report.config = parseSavedReportConfig({ ...report.config, ...req.body })
    }

    await report.save()
    handleResponses(res, 200, report)
})

export const deleteSavedReport = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { reportId } = req.params

    validateRequiredFields({ reportId }, ['reportId'])

    const report = await validateOwnership(
        SavedReport,
        reportId,
        userId,
        'Saved report not found'
    )
    await report.deleteOne()
    handleResponses(res, 200, { message: 'Saved report deleted' })
})

export const runSavedReport = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)
    const { reportId } = req.params

    validateRequiredFields({ reportId }, ['reportId'])

    const report = await validateOwnership(
        SavedReport,
        reportId,
        userId,
        'Saved report not found'
    )

    const period = resolveReportPeriod(configToPeriodQuery(report.config), timezone)
    const result = await executeCustomReportQuery(userId, period, {
        splitBy: report.config.splitBy,
        chartType: report.config.chartType,
        dataType: report.config.dataType,
        groupBy: report.config.groupBy ?? 'month',
        timezone,
    })

    handleResponses(res, 200, {
        savedReportId: report._id.toString(),
        name: report.name,
        config: report.config,
        result,
    })
})
