import { Types } from 'mongoose'

import { computePayoutVariance } from '@core/billing/payoutReconciliation'
import { financialYearOf, isValidFinancialYear } from '@core/billing/financialYear'
import { isDuplicateKeyError } from '@core/db/objectId'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import {
    computeFinancialYearRevenue,
    computeLocalRevenueByCurrency,
    isValidPeriodMonth,
    runRevenueRecognitionSweep,
    type FinancialYearRevenueSummary,
    type IProviderPayout,
    type RevenueRecognitionSweepResult,
} from '@modules/billing'

import { recordAudit } from './adminAudit.service'
import {
    createProviderPayout,
    findProviderPayouts,
    findRevenueRecognitionEntries,
    findRevenueRecognitionSummary,
    updateProviderPayoutFields,
    type RevenueRecognitionSummaryRow,
    type UpdateProviderPayoutInput,
} from './adminData.service'
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
/**
 * M8f - the admin-facing payout-reconciliation surface: MoR-reported payouts, matched against local
 * revenue computed by `payoutReconciliation.service.ts` (`modules/billing`), plus the manual
 * FIRC-reference / bank-deposit fields M8d needs once real payouts start. No live MoR payout API
 * exists yet (no MoR account until M0), so `reportedPayoutMinor` is admin-entered rather than fetched.
 */

const CURRENCY_PATTERN = /^[a-z]{3}$/

const requireMonth = (value: unknown): string => {
    if (typeof value !== 'string' || !isValidPeriodMonth(value)) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_PAYOUT, 400)
    return value
}

const requireCurrency = (value: unknown): string => {
    if (typeof value !== 'string' || !CURRENCY_PATTERN.test(value)) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_PAYOUT, 400)
    return value
}

const requireAmountMinor = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_PAYOUT, 400)
    return value
}

const parseOptionalAmountMinor = (value: unknown): number | null => {
    if (value === null) return null
    return requireAmountMinor(value)
}

const parseOptionalText = (value: unknown, maxLength: number): string | null => {
    if (value === null) return null
    if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_PAYOUT, 400)
    return value
}

const parseOptionalDate = (value: unknown): Date | null => {
    if (value === null) return null
    if (typeof value !== 'string') throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_PAYOUT, 400)
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_PAYOUT, 400)
    return date
}

export interface PayoutReconciliationRow {
    id: string
    periodMonth: string
    currency: string
    reportedPayoutMinor: number
    localRevenueMinor: number
    varianceMinor: number
    variancePercent: number
    flagged: boolean
    note: string | null
    firc: string | null
    bankDepositRef: string | null
    bankDepositDate: Date | null
    bankDepositAmountMinor: number | null
    createdAt: Date
    updatedAt: Date
}

const toReconciliationRow = (payout: IProviderPayout, localRevenueByCurrency: Record<string, number>): PayoutReconciliationRow => {
    const localRevenueMinor = localRevenueByCurrency[payout.currency] ?? 0
    const variance = computePayoutVariance(payout.reportedPayoutMinor, localRevenueMinor)
    return {
        id: payout._id.toString(),
        periodMonth: payout.periodMonth,
        currency: payout.currency,
        reportedPayoutMinor: payout.reportedPayoutMinor,
        localRevenueMinor,
        varianceMinor: variance.varianceMinor,
        variancePercent: variance.variancePercent,
        flagged: variance.flagged,
        note: payout.note,
        firc: payout.firc,
        bankDepositRef: payout.bankDepositRef,
        bankDepositDate: payout.bankDepositDate,
        bankDepositAmountMinor: payout.bankDepositAmountMinor,
        createdAt: payout.createdAt,
        updatedAt: payout.updatedAt,
    }
}

export const getPayoutReconciliationSummary = async (
    query: Record<string, unknown>
): Promise<{ range: RecognitionRange; payouts: PayoutReconciliationRow[] }> => {
    const range = parseRecognitionRange(query)
    const payouts = await findProviderPayouts(range.fromMonth, range.toMonth)

    const localRevenueByMonth = new Map<string, Record<string, number>>()
    const rows: PayoutReconciliationRow[] = []
    for (const payout of payouts) {
        let localRevenue = localRevenueByMonth.get(payout.periodMonth)
        if (!localRevenue) {
            localRevenue = await computeLocalRevenueByCurrency(payout.periodMonth)
            localRevenueByMonth.set(payout.periodMonth, localRevenue)
        }
        rows.push(toReconciliationRow(payout, localRevenue))
    }

    return { range, payouts: rows }
}

/** Admin-entered: matches what the MoR reported paying out for one period+currency. Rejects a second entry for the same period+currency - correct a mistake via the update endpoint instead. */
export const recordProviderPayout = async (
    actor: AdminPrincipal,
    ctx: AdminRequestContext,
    body: Record<string, unknown>,
    now: Date = new Date()
): Promise<PayoutReconciliationRow> => {
    const periodMonth = requireMonth(body.periodMonth)
    const currency = requireCurrency(body.currency)
    const reportedPayoutMinor = requireAmountMinor(body.reportedPayoutMinor)
    const note = body.note === undefined ? null : parseOptionalText(body.note, 500)

    let payout: IProviderPayout
    try {
        payout = await createProviderPayout({
            periodMonth,
            currency,
            reportedPayoutMinor,
            note,
            recordedByAdminId: new Types.ObjectId(actor.id),
        })
    } catch (error) {
        if (isDuplicateKeyError(error)) throw new CustomError(ERROR_MESSAGES.ADMIN.PAYOUT_ALREADY_RECORDED, 409)
        throw error
    }

    await recordAudit({
        adminId: actor.id,
        adminRole: actor.role,
        action: 'finance.payout_recorded',
        after: { periodMonth },
        amountMinor: reportedPayoutMinor,
        currency,
        ip: ctx.ip,
        requestId: ctx.requestId,
        at: now,
    })

    return toReconciliationRow(payout, await computeLocalRevenueByCurrency(periodMonth))
}

/** Patches only the fields present in `body` - `reportedPayoutMinor` (a correction) and the M8d manual fields (`firc`, `bankDepositRef`, `bankDepositDate`, `bankDepositAmountMinor`, `note`), each nullable to clear it. */
export const updateProviderPayout = async (
    actor: AdminPrincipal,
    ctx: AdminRequestContext,
    payoutId: string,
    body: Record<string, unknown>,
    now: Date = new Date()
): Promise<PayoutReconciliationRow> => {
    if (!Types.ObjectId.isValid(payoutId)) throw new CustomError(ERROR_MESSAGES.ADMIN.PAYOUT_NOT_FOUND, 404)

    const updates: UpdateProviderPayoutInput = {}
    if ('reportedPayoutMinor' in body) updates.reportedPayoutMinor = requireAmountMinor(body.reportedPayoutMinor)
    if ('note' in body) updates.note = parseOptionalText(body.note, 500)
    if ('firc' in body) updates.firc = parseOptionalText(body.firc, 200)
    if ('bankDepositRef' in body) updates.bankDepositRef = parseOptionalText(body.bankDepositRef, 200)
    if ('bankDepositDate' in body) updates.bankDepositDate = parseOptionalDate(body.bankDepositDate)
    if ('bankDepositAmountMinor' in body) updates.bankDepositAmountMinor = parseOptionalAmountMinor(body.bankDepositAmountMinor)

    if (Object.keys(updates).length === 0) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_PAYOUT, 400)

    const payout = await updateProviderPayoutFields(payoutId, updates)
    if (!payout) throw new CustomError(ERROR_MESSAGES.ADMIN.PAYOUT_NOT_FOUND, 404)

    await recordAudit({
        adminId: actor.id,
        adminRole: actor.role,
        action: 'finance.payout_updated',
        after: {
            periodMonth: payout.periodMonth,
            firc: payout.firc,
            bankDepositRef: payout.bankDepositRef,
            bankDepositDate: payout.bankDepositDate,
            bankDepositAmountMinor: payout.bankDepositAmountMinor,
        },
        amountMinor: updates.reportedPayoutMinor ?? null,
        currency: updates.reportedPayoutMinor !== undefined ? payout.currency : null,
        ip: ctx.ip,
        requestId: ctx.requestId,
        at: now,
    })

    return toReconciliationRow(payout, await computeLocalRevenueByCurrency(payout.periodMonth))
}

/**
 * M8g - the GST-registration-threshold revenue surface: a financial-year running-revenue-total for
 * the CA to use (`M8a`). Data only - no GST-registration determination and no currency conversion
 * happen here, both left to the CA; the response reports whatever currencies Corvale actually
 * recognized revenue in, exactly as recorded.
 */
const requireOptionalFinancialYear = (value: unknown): string | undefined => {
    if (value === undefined || value === '') return undefined
    if (typeof value !== 'string' || !isValidFinancialYear(value)) throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_QUERY, 400)
    return value
}

export const getFinancialYearRevenueSummary = async (
    query: Record<string, unknown>,
    now: Date = new Date()
): Promise<FinancialYearRevenueSummary> => {
    const financialYear = requireOptionalFinancialYear(query.financialYear) ?? financialYearOf(now)
    return computeFinancialYearRevenue(financialYear, now)
}

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
