import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import { AuthRequest } from '@http/middleware/authTypes'
import { CustomError } from '@core/errors/customError'
import { DEFAULT_TIMEZONE } from '@core/time/timezoneUtils'
import { parseOptionalWorkspaceId } from '@core/access/workspace'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'
import { resolveClientObjectId } from '@core/db/objectId'
import { validateRequiredFields } from '@core/http/validation'
import {
    createSavedReport as createSavedReportService,
    deleteSavedReport as deleteSavedReportService,
    listSavedReports as listSavedReportsService,
    runSavedReport as runSavedReportService,
    updateSavedReport as updateSavedReportService,
} from './savedReport.service'

const getUserTimezone = (req: AuthRequest): string =>
    req.user?.timezone?.trim() || DEFAULT_TIMEZONE

export const listSavedReports = asyncHandler(async (req: AuthRequest, res: Response) => {
    const reports = await listSavedReportsService(
        getUserId(req),
        parseOptionalWorkspaceId(req.query.workspaceId) ?? null
    )
    handleResponses(res, 200, reports)
})

export const createSavedReport = asyncHandler(async (req: AuthRequest, res: Response) => {
    validateRequiredFields(req.body, ['name'])

    const name = String(req.body.name).trim()
    if (!name) {
        throw new CustomError('Report name is required', 400)
    }

    const report = await createSavedReportService({
        userId: getUserId(req),
        name,
        workspaceId: parseOptionalWorkspaceId(req.body.workspaceId) ?? null,
        configBody: req.body,
        clientId: resolveClientObjectId(req.body._id) ?? null,
    })
    handleResponses(res, 201, report)
})

export const updateSavedReport = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { reportId } = req.params
    validateRequiredFields({ reportId }, ['reportId'])

    const report = await updateSavedReportService({
        reportId,
        userId: getUserId(req),
        name: req.body.name,
        body: req.body,
    })
    handleResponses(res, 200, report)
})

export const deleteSavedReport = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { reportId } = req.params
    validateRequiredFields({ reportId }, ['reportId'])

    await deleteSavedReportService(reportId, getUserId(req))
    handleResponses(res, 200, { message: 'Saved report deleted' })
})

export const runSavedReport = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { reportId } = req.params
    validateRequiredFields({ reportId }, ['reportId'])

    handleResponses(
        res,
        200,
        await runSavedReportService(reportId, getUserId(req), getUserTimezone(req))
    )
})
