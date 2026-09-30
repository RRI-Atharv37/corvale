import { PLAN_CODES, type PlanCode } from '@core/billing/constants'

import { BILLING_INTERVALS, type BillingInterval } from './providers/billingProvider'

export interface LedgerPayment {
    total: number
    currency: string
    interval: BillingInterval | null
    planCode: PlanCode | null
}

export const normalizeCurrency = (currency: string): string => currency.toUpperCase()

/**
 * What a `payment.succeeded` ledger row says about the money, read from the row alone. The interval and
 * plan are stamped from the price when the event is parsed, so a later plan change or an erased
 * subscription row cannot change how a payment already taken is classified.
 */
export const readLedgerPayment = (payload: unknown): LedgerPayment | null => {
    if (!payload || typeof payload !== 'object') return null
    const { total, currency, interval, planCode, refunded } = payload as Record<string, unknown>
    if (refunded || typeof total !== 'number' || total <= 0 || typeof currency !== 'string') return null

    return {
        total,
        currency: normalizeCurrency(currency),
        interval: (BILLING_INTERVALS as readonly unknown[]).includes(interval) ? (interval as BillingInterval) : null,
        planCode: (PLAN_CODES as readonly unknown[]).includes(planCode) ? (planCode as PlanCode) : null,
    }
}
