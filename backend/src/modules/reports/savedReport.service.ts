import SavedReport, { ISavedReport, ISavedReportConfig } from './savedReport.model'
import { CustomError } from '@core/errors/customError'
import {
    executeCustomReportQuery,
    parseCustomReportChartType,
    parseCustomReportDataType,
    parseCustomReportSplitBy,
    parseReportPeriodType,
    resolveReportPeriod,
} from './reportUtils'
import { Types } from 'mongoose'
import { buildScopedListFilter } from '@core/access/workspace'
import { isDuplicateKeyError } from '@core/db/objectId'
import { validateRequiredFields } from '@core/http/validation'
import { parseDashboardGroupBy } from '@modules/dashboard/dashboardUtils'
import { assertWorkspaceMembership, validateResourceAccess } from '@modules/workspaces/access'

const SAVED_REPORT_NOT_FOUND = 'Saved report not found'

/** Parse a saved-report config from a loose body/config bag. Pure. */
export const parseSavedReportConfig = (body: Record<string, unknown>): ISavedReportConfig => {
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

const loadSavedReport = (
    reportId: string,
    userId: string,
    minRole: 'viewer' | 'editor'
): Promise<ISavedReport> =>
    validateResourceAccess<ISavedReport>(
        SavedReport,
        reportId,
        userId,
        SAVED_REPORT_NOT_FOUND,
        minRole
    )

export const listSavedReports = async (
    userId: string,
    workspaceId: string | null
): Promise<ISavedReport[]> => {
    if (workspaceId) {
        await assertWorkspaceMembership(workspaceId, userId, 'viewer')
    }
    return SavedReport.find(buildScopedListFilter(userId, workspaceId)).sort({ updatedAt: -1 })
}

export interface CreateSavedReportInput {
    userId: string
    name: string
    workspaceId: string | null
    configBody: Record<string, unknown>
    clientId: Types.ObjectId | null
}

export const createSavedReport = async (
    input: CreateSavedReportInput
): Promise<ISavedReport> => {
    if (input.workspaceId) {
        await assertWorkspaceMembership(input.workspaceId, input.userId, 'editor')
    }

    const config = parseSavedReportConfig(input.configBody)

    try {
        return await SavedReport.create({
            ...(input.clientId ? { _id: input.clientId } : {}),
            userId: input.userId,
            workspaceId: input.workspaceId,
            name: input.name,
            config,
        })
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw new CustomError('A saved report with this id already exists', 400)
        }
        throw error
    }
}

export interface UpdateSavedReportInput {
    reportId: string
    userId: string
    name?: string
    /** The raw request body — a config re-parse is triggered when it carries `periodType`. */
    body: Record<string, unknown>
}

export const updateSavedReport = async (
    input: UpdateSavedReportInput
): Promise<ISavedReport> => {
    const report = await loadSavedReport(input.reportId, input.userId, 'editor')

    if (typeof input.name === 'string' && input.name.trim()) {
        report.name = input.name.trim()
    }

    if (input.body.periodType !== undefined) {
        report.config = parseSavedReportConfig({ ...report.config, ...input.body })
    }

    await report.save()
    return report
}

export const deleteSavedReport = async (reportId: string, userId: string): Promise<void> => {
    const report = await loadSavedReport(reportId, userId, 'editor')
    report.deletedAt = new Date()
    await report.save()
}

export const runSavedReport = async (
    reportId: string,
    userId: string,
    timezone: string
) => {
    const report = await loadSavedReport(reportId, userId, 'viewer')

    const period = resolveReportPeriod(configToPeriodQuery(report.config), timezone)
    const result = await executeCustomReportQuery(userId, period, {
        splitBy: report.config.splitBy,
        chartType: report.config.chartType,
        dataType: report.config.dataType,
        groupBy: report.config.groupBy ?? 'month',
        timezone,
        workspaceId: report.workspaceId?.toString() ?? null,
    })

    return {
        savedReportId: report._id.toString(),
        name: report.name,
        config: report.config,
        result,
    }
}
