import type { RecurringInterval } from '@features/recurring/types'

export interface Subscription {
    ruleId: string
    title: string
    amount: number
    currency: string
    interval: RecurringInterval
    monthlyCost: number
    annualCost: number
    nextChargeDate: string
    categoryId: string
    accountId: string
    isCancelled: boolean
}

export interface SubscriptionsResponse {
    subscriptions: Subscription[]
    totalMonthlyCost: number
    totalAnnualCost: number
}
