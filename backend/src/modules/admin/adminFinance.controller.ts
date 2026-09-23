import type { Response } from 'express'
import asyncHandler from 'express-async-handler'

import { buildCsvRow } from '@core/http/csv'
import { handleResponses } from '@core/http/response'

import {
    getFinancialYearRevenueSummary,
    getPayoutReconciliationSummary,
    getRevenueRecognitionSummary,
    recordProviderPayout,
    revenueRecognitionEntriesCursor,
    runRevenueRecognitionNow,
    updateProviderPayout,
} from './adminFinance.service'
import { requestContext, type AdminRequest } from './adminAuth.middleware'
import type { AdminPrincipal } from './adminTypes'

const principalOf = (req: AdminRequest): AdminPrincipal => req.admin as AdminPrincipal

export const recognitionSummary = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await getRevenueRecognitionSummary(req.query))
})

const CSV_HEADERS = ['recognitionMonth', 'planCode', 'bucketIndex', 'recognizedAmountMinor', 'currency', 'paymentOccurredAt']

export const recognitionExportCsv = asyncHandler(async (req: AdminRequest, res: Response) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="revenue-recognition.csv"')
    res.write(buildCsvRow(CSV_HEADERS) + '\n')

    for await (const entry of revenueRecognitionEntriesCursor(req.query)) {
        if (res.destroyed) break
        res.write(
            buildCsvRow([
                entry.recognitionMonth,
                entry.planCode,
                entry.bucketIndex,
                entry.recognizedAmountMinor,
                entry.currency,
                entry.paymentOccurredAt.toISOString(),
            ]) + '\n'
        )
    }

    res.end()
})

export const recognitionRun = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await runRevenueRecognitionNow(principalOf(req), requestContext(req)))
})

export const fyRevenueSummary = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await getFinancialYearRevenueSummary(req.query))
})

export const payoutReconciliationSummary = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await getPayoutReconciliationSummary(req.query))
})

export const recordPayout = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 201, await recordProviderPayout(principalOf(req), requestContext(req), req.body))
})

export const updatePayout = asyncHandler(async (req: AdminRequest, res: Response) => {
    handleResponses(res, 200, await updateProviderPayout(principalOf(req), requestContext(req), req.params.payoutId, req.body))
})
