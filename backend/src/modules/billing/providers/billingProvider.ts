import type { PlanCode, SubscriptionStatus } from '@core/billing/constants'

export const BILLING_INTERVALS = ['monthly', 'annual'] as const
export type BillingInterval = (typeof BILLING_INTERVALS)[number]

export const KNOWN_BILLING_EVENT_TYPES = [
    'checkout.completed',
    'subscription.created',
    'subscription.updated',
    'subscription.deleted',
    'payment.succeeded',
    'payment.failed',
    'refund.issued',
    'dispute.opened',
] as const
export type KnownBillingEventType = (typeof KNOWN_BILLING_EVENT_TYPES)[number]

/** Adapters pass through provider events they do not map, so the ledger still records them. */
export type BillingEventType = KnownBillingEventType | (string & Record<never, never>)

export type WebhookHeaders = Record<string, string | string[] | undefined>

/**
 * A provider webhook reduced to what the handler needs. Every field but the id, type and time is
 * optional: an adapter only sets what the provider actually said, and the handler never infers
 * entitlement from what is absent.
 */
export interface NormalizedBillingEvent {
    /** Stable across redeliveries of the same event - the ledger's idempotency key. */
    providerEventId: string
    type: BillingEventType
    occurredAt: Date
    /** Set only when the checkout carried our user id; never trusted to move an existing link. */
    userId?: string
    providerCustomerId?: string
    providerSubscriptionId?: string
    planCode?: string | null
    status?: SubscriptionStatus
    currentPeriodEnd?: Date | null
    trialEndsAt?: Date | null
    cancelAtPeriodEnd?: boolean
    /** Minimised for storage: ids, states and amounts only, never an email or a name. */
    payload?: Record<string, unknown>
}

export interface CheckoutSessionInput {
    userId: string
    email: string
    planCode: PlanCode
    interval: BillingInterval
    returnUrl?: string
}

export interface PortalInput {
    providerCustomerId: string
}

export interface HostedUrl {
    url: string
}

export interface BillingProvider {
    readonly name: string
    createCheckoutSession(input: CheckoutSessionInput): Promise<HostedUrl>
    getPortalUrl(input: PortalInput): Promise<HostedUrl>
    /** Checks the signature over the raw bytes. Runs before `parseEvent`; never throws. */
    verifyWebhook(rawBody: Buffer, headers: WebhookHeaders): boolean
    /** Throws a 400 `CustomError` on a body that is not a well-formed event of this provider. */
    parseEvent(rawBody: Buffer): NormalizedBillingEvent
}
