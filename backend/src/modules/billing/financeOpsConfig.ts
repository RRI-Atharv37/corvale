/** Bookkeeping-only surface (M8e/M8f/M8g): deferred-revenue recognition and the reports built on it. Off by default. */
export const isFinanceOpsEnabled = (): boolean => process.env.FINANCE_OPS_ENABLED === 'true'
