/**
 * M8g - pure Indian-financial-year math (1 April - 31 March, UTC calendar months) for the
 * GST-registration-threshold revenue surface. No Mongoose, no wall-clock reads, framework-agnostic
 * like `revenueRecognition.ts` / `payoutReconciliation.ts` - the one place the admin summary and its
 * tests agree on where a financial year starts and ends.
 */

export const FINANCIAL_YEAR_PATTERN = /^\d{4}-\d{2}$/

/** "2026-27" style label: `startYear` must be a 4-digit year and the suffix must be `startYear + 1`'s last two digits. */
export const isValidFinancialYear = (value: string): boolean => {
    if (!FINANCIAL_YEAR_PATTERN.test(value)) return false
    const [startYearText, suffix] = value.split('-')
    const startYear = Number(startYearText)
    const expectedSuffix = String((startYear + 1) % 100).padStart(2, '0')
    return suffix === expectedSuffix
}

/** The financial-year label containing `date` - April of year Y through March of year Y+1 is `"Y-(Y+1 mod 100)"`. */
export const financialYearOf = (date: Date): string => {
    const calendarYear = date.getUTCFullYear()
    const startYear = date.getUTCMonth() >= 3 ? calendarYear : calendarYear - 1
    return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

/** The 12 UTC calendar months (`YYYY-MM`), April through March, that make up financial year `fy`, in order. */
export const monthsInFinancialYear = (fy: string): string[] => {
    const startYear = Number(fy.split('-')[0])
    return Array.from({ length: 12 }, (_, i) => {
        const date = new Date(Date.UTC(startYear, 3 + i, 1))
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
    })
}

/**
 * The months of financial year `fy` that have started by `asOf` - a "running total" excludes
 * months still in the future so a mid-year read never implies revenue for months that haven't
 * happened yet.
 */
export const elapsedMonthsInFinancialYear = (fy: string, asOf: Date): string[] => {
    const currentMonthKey = `${asOf.getUTCFullYear()}-${String(asOf.getUTCMonth() + 1).padStart(2, '0')}`
    return monthsInFinancialYear(fy).filter((month) => month <= currentMonthKey)
}
