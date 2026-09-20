import {
    type FeatureKey,
    type GrandfatherKind,
    type LimitKey,
    type PlanCode,
    type SubscriptionStatus,
} from './constants'

export * from './constants'

export const TRIAL_LENGTH_DAYS = 30
export const TRIAL_PLAN_CODE: PlanCode = 'pro'
export const DEFAULT_PAST_DUE_GRACE_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

export interface PlanDefinition {
    code: PlanCode
    features: Record<FeatureKey, boolean>
    limits: Record<LimitKey, number | null>
}

export interface SubscriptionSnapshot {
    planCode: PlanCode
    status: SubscriptionStatus
    trialEndsAt: Date | null
    currentPeriodEnd: Date | null
    cancelAtPeriodEnd: boolean
    pastDueSince: Date | null
    grandfatherKind: GrandfatherKind | null
}

export interface ResolveOptions {
    pastDueGraceDays?: number
}

export interface Entitlements {
    billingEnabled: boolean
    status: SubscriptionStatus | 'none'
    planCode: PlanCode | null
    canRead: true
    canWrite: boolean
    canExport: true
    canSyncPull: true
    canSyncPush: boolean
    features: Record<FeatureKey, boolean>
    limits: Record<LimitKey, number | null>
    trialEndsAt: Date | null
    currentPeriodEnd: Date | null
    cancelAtPeriodEnd: boolean
    graceEndsAt: Date | null
}

const NO_FEATURES: Readonly<Record<FeatureKey, boolean>> = Object.freeze({
    workspaces: false,
    prioritySupport: false,
    bankSync: false,
})

// Zero, not null: `null` means unlimited, and a missing plan must never widen a limit.
const NO_LIMITS: Readonly<Record<LimitKey, number | null>> = Object.freeze({
    receiptStorageBytes: 0,
    syncDevices: 0,
    workspaceMembers: 0,
})

const deepFreeze = <T extends object>(value: T): T => {
    for (const nested of Object.values(value)) {
        if (nested && typeof nested === 'object') deepFreeze(nested)
    }
    return Object.freeze(value)
}

export const UNLIMITED_ENTITLEMENTS: Readonly<Entitlements> = deepFreeze({
    billingEnabled: false,
    status: 'active',
    planCode: null,
    canRead: true,
    canWrite: true,
    canExport: true,
    canSyncPull: true,
    canSyncPush: true,
    features: { workspaces: true, prioritySupport: true, bankSync: true },
    limits: { receiptStorageBytes: null, syncDevices: null, workspaceMembers: null },
    trialEndsAt: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    graceEndsAt: null,
} satisfies Entitlements)

export const cloneEntitlements = (source: Readonly<Entitlements>): Entitlements => ({
    ...source,
    features: { ...source.features },
    limits: { ...source.limits },
})

export const buildTrialSubscription = (now: Date): SubscriptionSnapshot => ({
    planCode: TRIAL_PLAN_CODE,
    status: 'trialing',
    trialEndsAt: new Date(now.getTime() + TRIAL_LENGTH_DAYS * DAY_MS),
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    pastDueSince: null,
    grandfatherKind: null,
})

interface DerivedState {
    status: SubscriptionStatus
    canWrite: boolean
    graceEndsAt: Date | null
}

// Expiry is derived from `now`, never from a job having run. Anything ambiguous (a `trialing`
// row with no end date, a `past_due` row with no start) fails toward access, not a lockout.
const deriveState = (
    subscription: SubscriptionSnapshot,
    now: Date,
    pastDueGraceDays: number
): DerivedState => {
    if (subscription.grandfatherKind === 'free_forever') {
        return { status: 'active', canWrite: true, graceEndsAt: null }
    }

    const nowMs = now.getTime()

    switch (subscription.status) {
        case 'trialing': {
            const expired = subscription.trialEndsAt !== null && nowMs >= subscription.trialEndsAt.getTime()
            return expired
                ? { status: 'trial_expired', canWrite: false, graceEndsAt: null }
                : { status: 'trialing', canWrite: true, graceEndsAt: null }
        }
        case 'active': {
            const lapsed =
                subscription.cancelAtPeriodEnd &&
                subscription.currentPeriodEnd !== null &&
                nowMs >= subscription.currentPeriodEnd.getTime()
            return lapsed
                ? { status: 'cancelled', canWrite: false, graceEndsAt: null }
                : { status: 'active', canWrite: true, graceEndsAt: null }
        }
        case 'past_due': {
            if (subscription.pastDueSince === null) {
                return { status: 'past_due', canWrite: true, graceEndsAt: null }
            }
            const graceEndsAt = new Date(subscription.pastDueSince.getTime() + pastDueGraceDays * DAY_MS)
            return { status: 'past_due', canWrite: nowMs < graceEndsAt.getTime(), graceEndsAt }
        }
        case 'trial_expired':
        case 'cancelled':
            return { status: subscription.status, canWrite: false, graceEndsAt: null }
    }
}

export const resolveEntitlements = (
    subscription: SubscriptionSnapshot | null,
    plan: PlanDefinition | null,
    now: Date,
    options: ResolveOptions = {}
): Entitlements => {
    if (!subscription) {
        return {
            billingEnabled: true,
            status: 'none',
            planCode: null,
            canRead: true,
            canWrite: false,
            canExport: true,
            canSyncPull: true,
            canSyncPush: false,
            features: { ...NO_FEATURES },
            limits: { ...NO_LIMITS },
            trialEndsAt: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            graceEndsAt: null,
        }
    }

    const { status, canWrite, graceEndsAt } = deriveState(
        subscription,
        now,
        options.pastDueGraceDays ?? DEFAULT_PAST_DUE_GRACE_DAYS
    )

    return {
        billingEnabled: true,
        status,
        planCode: subscription.planCode,
        canRead: true,
        canWrite,
        canExport: true,
        canSyncPull: true,
        canSyncPush: canWrite,
        features: { ...(plan?.features ?? NO_FEATURES) },
        limits: { ...(plan?.limits ?? NO_LIMITS) },
        trialEndsAt: subscription.trialEndsAt,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        graceEndsAt,
    }
}

/**
 * True when adding `amount` to `used` would pass `limit` (`null` = unlimited). Landing exactly on
 * the limit is allowed. Any non-finite or negative input fails closed - a quota check that can't
 * trust its numbers refuses rather than waves the write through.
 */
export const wouldExceedQuota = (limit: number | null, used: number, amount: number): boolean => {
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(used) || used < 0) return true
    if (limit === null || amount === 0) return false
    return used + amount > limit
}
