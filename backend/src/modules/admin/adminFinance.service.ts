import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { runRevenueRecognitionSweep, type RevenueRecognitionSweepResult } from '@modules/billing'

import { recordAudit } from './adminAudit.service'
import { findRevenueRecognitionEntries, findRevenueRecognitionSummary, type RevenueRecognitionSummaryRow } from './adminData.service'
import type { AdminPrincipal, AdminRequestContext } from './adminTypes'

/**
 * M8e - the admin-facing read/trigger surface for the deferred-revenue ledger `revenueRecognition.service.ts`
 * (in `modules/billing`) writes. Bookkeeping only: nothing here reads a financial-content model
 * (`adminBoundary.test.ts`), and `DeferredRevenueEntry` itself carries no `userId` or other PII, so the
 * report and the CSV export built on it need no redaction pass.
 */

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

const parseMonth = (value: unknown): string | undefined => {
    if (value === undefined || value === '') return undefined
    if (typeof value !== 'string' || !MONTH_PATTERN.test(value)) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_QUERY, 400)
    return value
}

export interface RecognitionRange {
    fromMonth?: string
    toMonth?: string
}

export const parseRecognitionRange = (query: Record<string, unknown>): RecognitionRange => {
    const fromMonth = parseMonth(query.fromMonth)
    const toMonth = parseMonth(query.toMonth)
    if (fromMonth && toMonth && fromMonth > toMonth) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_QUERY, 400)
    return { fromMonth, toMonth }
}

export const getRevenueRecognitionSummary = async (
    query: Record<string, unknown>
): Promise<{ range: RecognitionRange; months: RevenueRecognitionSummaryRow[] }> => {
    const range = parseRecognitionRange(query)
    const months = await findRevenueRecognitionSummary(range.fromMonth, range.toMonth)
    return { range, months }
}

/** Cursor for the CSV export controller to stream, filtered by the same validated range as the summary. */
export const revenueRecognitionEntriesCursor = (query: Record<string, unknown>) => {
    const range = parseRecognitionRange(query)
    return findRevenueRecognitionEntries(range.fromMonth, range.toMonth)
}

/**
 * Admin-triggered on-demand run of the M8e sweep - the same one `runBillingSweeps` already
 * attempts on every scheduled pass. Idempotent (the sweep claims each `BillingEvent` at most
 * once via `revenueRecognizedAt`), so re-running it is always safe; this exists only so an
 * operator does not have to wait for the next scheduled sweep to backfill or verify.
 */
export const runRevenueRecognitionNow = async (
    actor: AdminPrincipal,
    ctx: AdminRequestContext,
    now: Date = new Date()
): Promise<RevenueRecognitionSweepResult> => {
    const result = await runRevenueRecognitionSweep()

    await recordAudit({
        adminId: actor.id,
        adminRole: actor.role,
        action: 'finance.recognition_run',
        after: { affectedCount: result.entriesCreated },
        ip: ctx.ip,
        requestId: ctx.requestId,
        at: now,
    })

    return result
}
