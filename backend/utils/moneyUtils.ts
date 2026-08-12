/** Convert a major-unit decimal amount (e.g. 10.50) to integer minor units (1050). */
export const toMinorUnits = (amount: number): number => {
    if (!Number.isFinite(amount)) {
        throw new Error('Invalid amount')
    }
    return Math.round((amount + Number.EPSILON) * 100)
}

/** Convert integer minor units back to a major-unit decimal. */
export const fromMinorUnits = (minorUnits: number): number => {
    return Math.round(minorUnits) / 100
}

/** Parse and validate a client-supplied amount, returning minor units. */
export const parseAmountToMinorUnits = (value: unknown): number => {
    const amount = Number(value)
    if (isNaN(amount) || amount < 0) {
        throw new Error('Invalid amount')
    }
    return toMinorUnits(amount)
}
