import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import { AuthRequest } from '@http/middleware/authTypes'
import { DEFAULT_TIMEZONE } from '@core/time/timezoneUtils'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'
import { parseOptionalWorkspaceId } from '@core/access/workspace'
import {
    CSV_HEADERS,
    buildTransactionDownload,
    filterTransactions as filterTransactionsService,
    listTransactions as listTransactionsService,
    searchTransactions as searchTransactionsService,
} from './transactionQuery.service'
import { sendTransactionExport, streamCsvExport } from './export'

const getUserTimezone = (req: AuthRequest): string =>
    req.user?.timezone?.trim() || DEFAULT_TIMEZONE

const queryInput = (req: AuthRequest) => ({
    userId: getUserId(req),
    workspaceId: parseOptionalWorkspaceId(req.query.workspaceId) ?? null,
    timezone: getUserTimezone(req),
    query: req.query as Record<string, unknown>,
})

export const getTransactions = asyncHandler(async (req: AuthRequest, res: Response) => {
    handleResponses(res, 200, await listTransactionsService(queryInput(req)))
})

export const filterTransactions = asyncHandler(async (req: AuthRequest, res: Response) => {
    handleResponses(res, 200, await filterTransactionsService(queryInput(req)))
})

export const searchTransactions = asyncHandler(async (req: AuthRequest, res: Response) => {
    handleResponses(res, 200, await searchTransactionsService(queryInput(req)))
})

export const downloadTransactions = asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await buildTransactionDownload(queryInput(req))

    if (result.kind === 'csv') {
        await streamCsvExport(res, 'transactions', CSV_HEADERS, result.rows)
        return
    }

    sendTransactionExport(res, result.format, 'transactions', result.payload)
})
