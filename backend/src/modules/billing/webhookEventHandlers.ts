import { KNOWN_BILLING_EVENT_TYPES, type KnownBillingEventType, type NormalizedBillingEvent } from './providers/billingProvider'

export type BillingEventOutcome = { status: 'applied' } | { status: 'unapplied'; reason: string }

export type BillingEventHandler = (event: NormalizedBillingEvent) => Promise<BillingEventOutcome>

/**
 * Filled in by M3c. Handlers write `Subscription` rows outside any request context, so every query
 * they issue passes `{ [RLS_BYPASS]: true }` explicitly rather than relying on the absence of one.
 */
const HANDLERS: Partial<Record<KnownBillingEventType, BillingEventHandler>> = {}

const isKnownEventType = (type: string): type is KnownBillingEventType =>
    (KNOWN_BILLING_EVENT_TYPES as readonly string[]).includes(type)

export const applyBillingEvent: BillingEventHandler = async (event) => {
    if (!isKnownEventType(event.type)) return { status: 'applied' }

    const handler = HANDLERS[event.type]
    if (!handler) return { status: 'unapplied', reason: `No handler for ${event.type}` }

    return handler(event)
}
