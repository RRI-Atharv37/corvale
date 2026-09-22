/**
 * M8e - pure deferred-revenue bucket math. No Mongoose, no wall-clock reads: a payment is
 * recognized over the year it paid for, one UTC calendar month at a time. Framework-agnostic like
 * `metrics.ts` / `retention.ts`, so it is unit-testable on its own and the one place the sweep
 * service and any future report agree on the shape.
 */

const RECOGNITION_MONTHS = 12

/** UTC `YYYY-MM` of a date - the recognition ledger's month key. */
export const monthKeyUtc = (date: Date): string => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`

/** The first day of the month `offset` months after `date`, UTC - rolls the year over correctly via `Date.UTC`. */
export const addUtcMonths = (date: Date, offset: number): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1))

export interface RecognitionBucket {
    /** 1-12: which month of the paid year this bucket recognizes. */
    bucketIndex: number
    recognitionMonth: string
    amountMinor: number
}

/**
 * Splits one annual payment into 12 monthly buckets starting the UTC calendar month the payment
 * occurred in. `totalMinor` rarely divides evenly by 12, so the remainder (always under 12 minor
 * units) is spread one unit each across the first buckets rather than dropped or piled onto the
 * last one - no bucket differs from another by more than one minor unit, and the buckets always
 * sum back to exactly `totalMinor`.
 */
export const splitIntoMonthlyBuckets = (totalMinor: number, paymentOccurredAt: Date): RecognitionBucket[] => {
    const base = Math.floor(totalMinor / RECOGNITION_MONTHS)
    const remainder = totalMinor - base * RECOGNITION_MONTHS

    return Array.from({ length: RECOGNITION_MONTHS }, (_, i) => ({
        bucketIndex: i + 1,
        recognitionMonth: monthKeyUtc(addUtcMonths(paymentOccurredAt, i)),
        amountMinor: base + (i < remainder ? 1 : 0),
    }))
}
