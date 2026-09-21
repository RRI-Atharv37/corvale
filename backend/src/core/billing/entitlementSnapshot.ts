import { isAdminGrantActive } from './adminGrant'
import {
    DEFAULT_PAST_DUE_GRACE_DAYS,
    cloneEntitlements,
    deriveProviderState,
    type DerivedState,
    type Entitlements,
    type SubscriptionSnapshot,
} from './entitlements'

/**
 * What the client caches next to the user. `writableUntil` is the instant write access lapses with
 * no further event (trial end, period end of a cancelling plan, close of the past-due grace), so an
 * offline client can drop to read-only on its own instead of trusting a stale `canWrite`.
 */
export interface EntitlementSnapshot extends Entitlements {
    resolvedAt: Date
    writableUntil: Date | null
}

export interface SnapshotOptions {
    pastDueGraceDays?: number
}

/** `null` means the provider state never lapses by itself. Only meaningful while the provider state is writable. */
const providerWritableUntil = (state: DerivedState, subscription: SubscriptionSnapshot): Date | null => {
    switch (state.status) {
        case 'trialing':
            return subscription.trialEndsAt
        case 'active':
            return subscription.cancelAtPeriodEnd ? subscription.currentPeriodEnd : null
        case 'past_due':
            return state.graceEndsAt
        default:
            return null
    }
}

const later = (a: Date, b: Date): Date => (a.getTime() >= b.getTime() ? a : b)

const writableUntilOf = (
    entitlements: Entitlements,
    subscription: SubscriptionSnapshot | null,
    now: Date,
    options: SnapshotOptions
): Date | null => {
    if (!entitlements.billingEnabled || !entitlements.canWrite) return null
    if (!subscription || subscription.grandfatherKind === 'free_forever') return null

    const grant = subscription.adminGrant
    if (grant && grant.kind === 'comp' && isAdminGrantActive(grant, now)) {
        const provider = deriveProviderState(subscription, now, options.pastDueGraceDays ?? DEFAULT_PAST_DUE_GRACE_DAYS)
        if (!provider.canWrite) return grant.until

        const until = providerWritableUntil(provider, subscription)
        return until === null ? null : later(until, grant.until)
    }

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
    now: Date,
    options: SnapshotOptions = {}
): EntitlementSnapshot => ({
    ...cloneEntitlements(entitlements),
    resolvedAt: now,
    writableUntil: writableUntilOf(entitlements, subscription, now, options),
})
