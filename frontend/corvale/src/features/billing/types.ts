import type { BillingFeature } from '@lib/types/api'

export type BillingInterval = 'monthly' | 'annual'
export type PlanCode = 'plus' | 'pro'

export interface PublicPlan {
    code: PlanCode
    name: string
    /** USD minor units. */
    prices: { monthly: number; annual: number }
    features: Record<BillingFeature, boolean>
    /** `null` = unlimited. */
    limits: {
        receiptStorageBytes: number | null
        syncDevices: number | null
        workspaceMembers: number | null
    }
}

export interface PublicPlans {
    billingEnabled: boolean
    trialDays: number
    plans: PublicPlan[]
}

export interface BillingOverview {
    billingEnabled: boolean
    hasBillingCustomer: boolean
    hasLiveSubscription: boolean
    /** Set only while the server is really enforcing a retention window. */
    retentionDays: number | null
}

export type InvoiceStatus = 'paid' | 'pending' | 'void' | 'refunded'

export interface Invoice {
    id: string
    issuedAt: string
    total: number
    currency: string
    status: InvoiceStatus
    url: string | null
}

export interface PlanSelection {
    planCode: PlanCode
    interval: BillingInterval
}

export type BillingNoticeKind =
    | 'trialing'
    | 'trial-expired'
    | 'past-due'
    | 'access-paused'
    | 'cancelling'
    | 'cancelled'
    | 'no-subscription'

export interface BillingNotice {
    kind: BillingNoticeKind
    tone: 'info' | 'warning' | 'danger'
    title: string
    message: string
    /** Label for the call to action that leads to the billing page. */
    cta: string
    daysLeft?: number
}
