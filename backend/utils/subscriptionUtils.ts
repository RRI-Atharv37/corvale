import { RecurringInterval } from '../models/RecurringRule'
import { TransactionType } from '../models/Transaction'

export const SUBSCRIPTION_ELIGIBLE_INTERVALS: RecurringInterval[] = [
    'daily',
    'weekly',
    'biweekly',
    'monthly',
]

interface SubscriptionEligibleRule {
    type: TransactionType
    isActive: boolean
    isArchived: boolean
    interval: RecurringInterval
}

/** A recurring rule qualifies as a subscription if it's an active, non-archived expense billed monthly or more often. */
export const isSubscriptionEligible = (rule: SubscriptionEligibleRule): boolean => {
    return (
        rule.type === 'expense' &&
        rule.isActive &&
        !rule.isArchived &&
        SUBSCRIPTION_ELIGIBLE_INTERVALS.includes(rule.interval)
    )
}

const ANNUAL_OCCURRENCES: Partial<Record<RecurringInterval, number>> = {
    daily: 365,
    weekly: 52,
    biweekly: 26,
    monthly: 12,
}

export const computeAnnualCostMinor = (amountMinor: number, interval: RecurringInterval): number => {
    const occurrences = ANNUAL_OCCURRENCES[interval]
    if (!occurrences) {
        throw new Error(`Unsupported subscription interval: ${interval}`)
    }
    return amountMinor * occurrences
}

export const computeMonthlyCostMinor = (amountMinor: number, interval: RecurringInterval): number => {
    return Math.round(computeAnnualCostMinor(amountMinor, interval) / 12)
}
