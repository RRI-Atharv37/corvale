import { describe, expect, it } from 'vitest'

import {
    UNLIMITED_ENTITLEMENTS,
    cloneEntitlements,
    resolveEntitlements,
    type PlanDefinition,
    type SubscriptionSnapshot,
} from '../entitlements'
import { buildEntitlementSnapshot } from '../entitlementSnapshot'

/**
 * M2d - the entitlement snapshot that rides on the user payload. It is the resolver's output plus
 * `resolvedAt` and `writableUntil`: the instant the resolved write access lapses on its own, so an
 * offline client can drop to read-only when a trial or period ends without asking the server.
 */

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-09-20T12:00:00.000Z')
const later = (days: number): Date => new Date(NOW.getTime() + days * DAY)

const PRO: PlanDefinition = {
    code: 'pro',
    features: { workspaces: true, prioritySupport: true, bankSync: true },
    limits: { receiptStorageBytes: 1000, syncDevices: null, workspaceMembers: 3 },
}

const sub = (fields: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot => ({
    planCode: 'pro',
    status: 'active',
    trialEndsAt: null,
    currentPeriodEnd: later(30),
    cancelAtPeriodEnd: false,
    pastDueSince: null,
    grandfatherKind: null,
    ...fields,
})

const snapshotOf = (subscription: SubscriptionSnapshot | null) =>
    buildEntitlementSnapshot(resolveEntitlements(subscription, subscription ? PRO : null, NOW), subscription, NOW)

describe('buildEntitlementSnapshot', () => {
    it('carries every resolver field through untouched', () => {
        const subscription = sub()
        const entitlements = resolveEntitlements(subscription, PRO, NOW)

        expect(buildEntitlementSnapshot(entitlements, subscription, NOW)).toMatchObject(entitlements)
    })

    it('stamps resolvedAt with the resolution time', () => {
        expect(snapshotOf(sub()).resolvedAt).toEqual(NOW)
    })

    it('a trialing user is writable until the trial ends', () => {
        const s = snapshotOf(sub({ status: 'trialing', trialEndsAt: later(10), currentPeriodEnd: null }))

        expect(s.canWrite).toBe(true)
        expect(s.writableUntil).toEqual(later(10))
    })

    it('an active subscription set to cancel is writable until the period ends', () => {
        const s = snapshotOf(sub({ cancelAtPeriodEnd: true, currentPeriodEnd: later(5) }))

        expect(s.writableUntil).toEqual(later(5))
    })

    it('an ordinary active subscription has no self-imposed end', () => {
        expect(snapshotOf(sub()).writableUntil).toBeNull()
    })

    it('a past_due subscription is writable until the grace window closes', () => {
        const s = snapshotOf(sub({ status: 'past_due', pastDueSince: new Date(NOW.getTime() - DAY) }))

        expect(s.canWrite).toBe(true)
        expect(s.writableUntil).toEqual(s.graceEndsAt)
        expect(s.writableUntil).not.toBeNull()
    })

    it('a past_due row with no start date has no known end (fails toward access)', () => {
        expect(snapshotOf(sub({ status: 'past_due', pastDueSince: null })).writableUntil).toBeNull()
    })

    it.each([
        ['trial_expired', { status: 'trial_expired' as const, trialEndsAt: later(-3), currentPeriodEnd: null }],
        ['cancelled', { status: 'cancelled' as const }],
        ['trialing but lapsed', { status: 'trialing' as const, trialEndsAt: later(-1), currentPeriodEnd: null }],
    ])('an already read-only state (%s) has no writableUntil', (_name, fields) => {
        const s = snapshotOf(sub(fields))

        expect(s.canWrite).toBe(false)
        expect(s.writableUntil).toBeNull()
    })

    it('a user with no subscription is read-only with no writableUntil', () => {
        const s = snapshotOf(null)

        expect(s.canWrite).toBe(false)
        expect(s.canRead).toBe(true)
        expect(s.canExport).toBe(true)
        expect(s.writableUntil).toBeNull()
    })

    it('a free_forever user never gets a self-imposed end, whatever the stored dates say', () => {
        const s = snapshotOf(
            sub({ grandfatherKind: 'free_forever', status: 'trialing', trialEndsAt: later(2), cancelAtPeriodEnd: true })
        )

        expect(s.canWrite).toBe(true)
        expect(s.writableUntil).toBeNull()
    })

    it('unlimited (billing off) is writable forever', () => {
        const s = buildEntitlementSnapshot(cloneEntitlements(UNLIMITED_ENTITLEMENTS), null, NOW)

        expect(s.billingEnabled).toBe(false)
        expect(s.canWrite).toBe(true)
        expect(s.writableUntil).toBeNull()
    })

    it('exposes no subscription internals (provider ids, grandfather kind, past-due start)', () => {
        const s = snapshotOf(sub({ grandfatherKind: 'locked_rate', status: 'past_due', pastDueSince: NOW }))

        expect(Object.keys(s).sort()).toEqual(
            [
                'billingEnabled',
                'status',
                'planCode',
                'canRead',
                'canWrite',
                'canExport',
                'canSyncPull',
                'canSyncPush',
                'features',
                'limits',
                'trialEndsAt',
                'currentPeriodEnd',
                'cancelAtPeriodEnd',
                'graceEndsAt',
                'resolvedAt',
                'writableUntil',
            ].sort()
        )
    })

    it('does not mutate or alias the entitlements it was given', () => {
        const entitlements = resolveEntitlements(sub(), PRO, NOW)
        const s = buildEntitlementSnapshot(entitlements, sub(), NOW)

        s.features.workspaces = false
        s.limits.syncDevices = 0

        expect(entitlements.features.workspaces).toBe(true)
        expect(entitlements.limits.syncDevices).toBeNull()
    })
})
