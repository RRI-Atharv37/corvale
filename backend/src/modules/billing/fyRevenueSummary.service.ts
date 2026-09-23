import { elapsedMonthsInFinancialYear } from '@core/billing/financialYear'

import { computeLocalRevenueByCurrency } from './payoutReconciliation.service'

/**
 * M8g - the GST-registration-threshold revenue surface: a financial-year running-revenue-total for
 * the CA to use when determining whether/when GST registration is required. Deliberately data only
 * - it reports what Corvale has recognized as local revenue, by currency, for each elapsed month of
 * the financial year; it makes no GST-registration determination and does no currency conversion
 * (the CA's job, not code's - see M8a). Built on the same read-time `computeLocalRevenueByCurrency`
 * M8f's payout reconciliation already uses, so a late-arriving payment for an earlier month is
 * picked up automatically the next time this is read, with no recompute step.
 */

export interface FinancialYearMonthRevenue {
    periodMonth: string
    totalsByCurrency: Record<string, number>
}

export interface FinancialYearRevenueSummary {
    financialYear: string
    monthsIncluded: string[]
    totalsByCurrency: Record<string, number>
    byMonth: FinancialYearMonthRevenue[]
}

export const computeFinancialYearRevenue = async (
    financialYear: string,
    asOf: Date = new Date()
): Promise<FinancialYearRevenueSummary> => {
    const monthsIncluded = elapsedMonthsInFinancialYear(financialYear, asOf)

    const totalsByCurrency: Record<string, number> = {}
    const byMonth: FinancialYearMonthRevenue[] = []
    for (const periodMonth of monthsIncluded) {
        const monthTotals = await computeLocalRevenueByCurrency(periodMonth)
        byMonth.push({ periodMonth, totalsByCurrency: monthTotals })
        for (const [currency, amountMinor] of Object.entries(monthTotals)) {
            totalsByCurrency[currency] = (totalsByCurrency[currency] ?? 0) + amountMinor
        }
    }

    return { financialYear, monthsIncluded, totalsByCurrency, byMonth }
}
