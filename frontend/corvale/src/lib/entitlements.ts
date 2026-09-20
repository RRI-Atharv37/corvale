import type { BillingFeature, EntitlementSnapshot, EntitlementStatus } from '@lib/types/api'

/**
 * The client's reading of the server's entitlement snapshot. UX only - the server enforces every
 * gate independently. The one rule that matters here: whenever the snapshot is missing, unreadable
 * or past its own expiry, fail OPEN TO READ-ONLY. A finance app must never lock a user out of
 * their own records because a token or a cache went stale offline.
 */

const FEATURES: readonly BillingFeature[] = ['workspaces', 'prioritySupport', 'bankSync']

export const READ_ONLY_ENTITLEMENTS: Readonly<EntitlementSnapshot> = Object.freeze({
    billingEnabled: true,
    status: 'none',
    planCode: null,
    canRead: true,
    canWrite: false,
    canExport: true,
    canSyncPull: true,
    canSyncPush: false,
    features: Object.freeze({ workspaces: false, prioritySupport: false, bankSync: false }),
    limits: Object.freeze({ receiptStorageBytes: 0, syncDevices: 0, workspaceMembers: 0 }),
    trialEndsAt: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    graceEndsAt: null,
    resolvedAt: new Date(0).toISOString(),
    writableUntil: null,
} satisfies EntitlementSnapshot)

const LAPSED_STATUS: Partial<Record<EntitlementStatus, EntitlementStatus>> = {
    trialing: 'trial_expired',
    active: 'cancelled',
}

const isUsable = (value: unknown): value is EntitlementSnapshot => {
    if (!value || typeof value !== 'object') return false
    const s = value as Partial<EntitlementSnapshot>
    return (
        typeof s.billingEnabled === 'boolean' &&
        typeof s.canWrite === 'boolean' &&
        !!s.features &&
        typeof s.features === 'object' &&
        FEATURES.every((feature) => typeof s.features?.[feature] === 'boolean')
    )
}

const parseTime = (iso: string): number => Date.parse(iso)

/**
 * Re-derives the one thing that can change without the server: write access lapsing at
 * `writableUntil`. It only ever tightens - a read-only snapshot is never widened - and read, export
 * and sync-pull are forced on regardless of what a cache says.
 */
export const resolveClientEntitlements = (
    snapshot: EntitlementSnapshot | null | undefined,
    now: Date
): Readonly<EntitlementSnapshot> => {
    if (!isUsable(snapshot)) return READ_ONLY_ENTITLEMENTS

    const lapsed =
        snapshot.billingEnabled &&
        snapshot.canWrite &&
        snapshot.writableUntil !== null &&
        !(parseTime(snapshot.writableUntil) > now.getTime())

    return {
        ...snapshot,
        canRead: true,
        canExport: true,
        canSyncPull: true,
        ...(lapsed
            ? { canWrite: false, canSyncPush: false, status: LAPSED_STATUS[snapshot.status] ?? snapshot.status }
            : {}),
    }
}

/** Milliseconds until a still-writable snapshot lapses on its own, or null when nothing is pending. */
export const msUntilWriteLapses = (snapshot: EntitlementSnapshot | null | undefined, now: Date): number | null => {
    if (!isUsable(snapshot) || !snapshot.billingEnabled || !snapshot.canWrite || snapshot.writableUntil === null) {
        return null
    }
    const remaining = parseTime(snapshot.writableUntil) - now.getTime()
    return Number.isFinite(remaining) && remaining > 0 ? remaining : null
}
