import { cloneEntitlements, type Entitlements, type SubscriptionSnapshot } from './entitlements'

/**
 * What the client caches next to the user. `writableUntil` is the instant write access lapses with
 * no further event (trial end, period end of a cancelling plan, close of the past-due grace), so an
 * offline client can drop to read-only on its own instead of trusting a stale `canWrite`.
 */
export interface EntitlementSnapshot extends Entitlements {
    resolvedAt: Date
    writableUntil: Date | null
}

const writableUntilOf = (entitlements: Entitlements, subscription: SubscriptionSnapshot | null): Date | null => {
    if (!entitlements.billingEnabled || !entitlements.canWrite) return null
    if (!subscription || subscription.grandfatherKind === 'free_forever') return null

    switch (entitlements.status) {
        case 'trialing':
            return subscription.trialEndsAt
        case 'active':
            return subscription.cancelAtPeriodEnd ? subscription.currentPeriodEnd : null
        case 'past_due':
            return entitlements.graceEndsAt
        default:
            return null
    }
}

export const buildEntitlementSnapshot = (
    entitlements: Entitlements,
    subscription: SubscriptionSnapshot | null,
    now: Date
): EntitlementSnapshot => ({
    ...cloneEntitlements(entitlements),
    resolvedAt: now,
    writableUntil: writableUntilOf(entitlements, subscription),
})
