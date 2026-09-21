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

/**
 * One provider subscription as the reconciliation pass compares it. Like an event, only what the
 * provider actually stated is set, and it never carries an email or a name.
 */
export interface ProviderSubscriptionSnapshot {
    providerSubscriptionId: string
    providerCustomerId?: string
    planCode?: string | null
    status?: SubscriptionStatus
    currentPeriodEnd?: Date | null
    trialEndsAt?: Date | null
    cancelAtPeriodEnd?: boolean
    /** When the provider last changed this subscription; separates drift from a webhook still in flight. */
    updatedAt: Date
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

export const PROVIDER_INVOICE_STATUSES = ['paid', 'pending', 'void', 'refunded'] as const
export type ProviderInvoiceStatus = (typeof PROVIDER_INVOICE_STATUSES)[number]

/** One charge as the billing screen lists it. Fetched live, never stored, and never carries an email or a name. */
export interface ProviderInvoice {
    id: string
    issuedAt: Date
    /** Minor units of `currency`. */
    total: number
    currency: string
    status: ProviderInvoiceStatus
    /** The provider-hosted invoice/receipt page; null unless it is an https URL. */
    url: string | null
}

export interface SubscriptionRef {
    providerSubscriptionId: string
}

export interface CancelSubscriptionInput extends SubscriptionRef {
    /** Stop billing now instead of at the close of the paid period; used only when the account is being erased. */
    immediate?: boolean
}

export interface PlanChangeInput extends SubscriptionRef {
    planCode: PlanCode
    interval: BillingInterval
}

export interface BillingProvider {
    readonly name: string
    createCheckoutSession(input: CheckoutSessionInput): Promise<HostedUrl>
    getPortalUrl(input: PortalInput): Promise<HostedUrl>
    /** Checks the signature over the raw bytes. Runs before `parseEvent`; never throws. */
    verifyWebhook(rawBody: Buffer, headers: WebhookHeaders): boolean
    /** Throws a 400 `CustomError` on a body that is not a well-formed event of this provider. */
    parseEvent(rawBody: Buffer): NormalizedBillingEvent
    /** Every subscription of this deployment's store, all pages. Throws a 502 `CustomError` rather than return a partial list. */
    listSubscriptions(): Promise<ProviderSubscriptionSnapshot[]>
    /** Most recent charges of one subscription, newest first. Throws a 502 `CustomError` when the provider cannot answer. */
    listInvoices(input: SubscriptionRef): Promise<ProviderInvoice[]>
    /**
     * The three calls below only *ask* the provider. None of them changes what Corvale believes: the
     * resulting state arrives on a signed webhook, like every other entitlement change.
     */
    changePlan(input: PlanChangeInput): Promise<void>
    /** Ends the subscription at the close of the paid period; the provider keeps billing until then. */
    cancelSubscription(input: CancelSubscriptionInput): Promise<void>
    resumeSubscription(input: SubscriptionRef): Promise<void>
}
