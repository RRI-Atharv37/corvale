/**
 * Central copy for the standing "this is an estimate / not advice" notes shown near Corvale's
 * predictive and advisory surfaces (V2). Rendered through `components/ui/Disclaimer.tsx`, usually
 * via `PageHeader`'s `note` slot. Not dismissible by design - always-on context, not one-time hints.
 *
 * Budgets and Home were audited for the same "on track" / prediction language and carry none:
 * budget progress is descriptive ("$X spent", "$Y left", "% used", "Over budget") and the dashboard
 * stat cards are period totals plus current balances, already labelled as such.
 */
export const DISCLAIMERS = {
    forecast:
        'Projected balances are estimates built from your recurring bills, scheduled goal contributions, and recent average spending. Real transactions will move these numbers.',
    debtPayoff:
        'Snowball and avalanche schedules are illustrative calculations, not financial advice. They assume fixed balances, interest rates, and payments, and ignore fees and promotional rates. Consider a qualified advisor before choosing a payoff strategy.',
    savingsGoalProjection:
        'Projected completion dates assume your recent contribution rate continues unchanged. They are estimates, not guarantees.',
    reportsAverages:
        'Savings rate and period averages describe the selected date range only — they are not forecasts of future income or spending.',
    subscriptions:
        'This list is inferred from recurring transaction patterns. Corvale can miss irregular charges or flag a one-off repeat, so treat it as a starting point rather than a complete record.',
} as const

export type DisclaimerKey = keyof typeof DISCLAIMERS
