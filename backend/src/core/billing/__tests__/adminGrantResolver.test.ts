import { describe, expect, it } from 'vitest'

import { buildEntitlementSnapshot } from '../entitlementSnapshot'
import {
    resolveEntitlements,
    type AdminGrantSnapshot,
    type PlanDefinition,
    type SubscriptionSnapshot,
} from '../entitlements'
import { isAdminGrantActive, isPlanUpgrade } from '../adminGrant'
import { isRetentionPaused, retentionClockStart } from '../retention'

/**
 * M7.3 - an admin grant is an OVERLAY on the provider's state: the resolver takes the better of the two, the
 * stored subscription is never rewritten, and expiry is derived from the clock like a trial's.
 */

const NOW = new Date('2026-09-21T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const days = (n: number): Date => new Date(NOW.getTime() + n * DAY)

const PLUS: PlanDefinition = {
    code: 'plus',
    features: { workspaces: false, prioritySupport: false, bankSync: false },
    limits: { receiptStorageBytes: 1000, syncDevices: 1, workspaceMembers: 2 },
}
const PRO: PlanDefinition = {
    code: 'pro',
    features: { workspaces: true, prioritySupport: true, bankSync: false },
    limits: { receiptStorageBytes: 10_000, syncDevices: null, workspaceMembers: 10 },
}

const base = (overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot => ({
    planCode: 'plus',
    status: 'active',
    trialEndsAt: null,
    currentPeriodEnd: days(20),
    cancelAtPeriodEnd: false,
    pastDueSince: null,
    grandfatherKind: null,
    ...overrides,
})

const comp = (until: Date, planCode: 'plus' | 'pro' = 'pro'): AdminGrantSnapshot => ({ kind: 'comp', planCode, until })
const override = (until: Date, extra: Partial<AdminGrantSnapshot> = {}): AdminGrantSnapshot => ({ kind: 'plan_override', planCode: null, until, ...extra })

const resolve = (subscription: SubscriptionSnapshot, grantPlan: PlanDefinition | null = PRO, plan: PlanDefinition = PLUS, now: Date = NOW) =>
    resolveEntitlements(subscription, plan, now, { grantPlan })

describe('isAdminGrantActive', () => {
    it('is active strictly before its end and never for null', () => {
        expect(isAdminGrantActive(comp(days(1)), NOW)).toBe(true)
        expect(isAdminGrantActive(comp(NOW), NOW)).toBe(false)
        expect(isAdminGrantActive(comp(days(-1)), NOW)).toBe(false)
        expect(isAdminGrantActive(null, NOW)).toBe(false)
        expect(isAdminGrantActive(undefined, NOW)).toBe(false)
    })
})

describe('comp - lifts a read-only state', () => {
    it.each([
        ['trial_expired', { status: 'trial_expired' as const, trialEndsAt: days(-3), currentPeriodEnd: null }],
        ['cancelled', { status: 'cancelled' as const }],
        ['past_due past grace', { status: 'past_due' as const, pastDueSince: days(-30) }],
        ['cancelling, period over', { cancelAtPeriodEnd: true, currentPeriodEnd: days(-1) }],
        ['a trial that ran out unswept', { status: 'trialing' as const, trialEndsAt: days(-1), currentPeriodEnd: null }],
    ])('%s becomes writable', (_name, overrides) => {
        const without = resolveEntitlements(base(overrides), PLUS, NOW)
        const withComp = resolve(base({ ...overrides, adminGrant: comp(days(30)) }))

        expect(without.canWrite).toBe(false)
        expect(withComp).toMatchObject({ canWrite: true, canSyncPush: true, status: 'active', planCode: 'pro', graceEndsAt: null })
    })

    it('takes its features and limits from the granted plan', () => {
        const result = resolve(base({ status: 'trial_expired', trialEndsAt: days(-3), adminGrant: comp(days(30)) }))

        expect(result.features).toEqual(PRO.features)
        expect(result.limits).toEqual(PRO.limits)
    })

    it('never lowers what the customer already pays for: the better plan and the larger limits win', () => {
        const result = resolve(base({ planCode: 'pro', adminGrant: comp(days(30), 'plus') }), PLUS, PRO)

        expect(result.planCode).toBe('pro')
        expect(result.features).toEqual(PRO.features)
        expect(result.limits).toEqual(PRO.limits)
    })

    it('raises a paying customer to the granted plan', () => {
        const result = resolve(base({ adminGrant: comp(days(30)) }))

        expect(result).toMatchObject({ planCode: 'pro', canWrite: true })
        expect(result.features.workspaces).toBe(true)
        expect(result.limits.syncDevices).toBeNull()
    })

    it('expires by the clock with no job having run', () => {
        const subscription = base({ status: 'cancelled', adminGrant: comp(days(2)) })

        expect(resolve(subscription).canWrite).toBe(true)
        expect(resolve(subscription, PRO, PLUS, days(2)).canWrite).toBe(false)
        expect(resolve(subscription, PRO, PLUS, days(3)).canWrite).toBe(false)
    })

    it('leaves the provider-owned facts alone', () => {
        const subscription = base({ status: 'cancelled', currentPeriodEnd: days(-4), adminGrant: comp(days(30)) })

        const result = resolve(subscription)

        expect(result.currentPeriodEnd).toEqual(days(-4))
        expect(subscription.status).toBe('cancelled')
    })

    it('keeps a free-forever account exactly as it was', () => {
        const result = resolve(base({ grandfatherKind: 'free_forever', status: 'cancelled', adminGrant: comp(days(30)) }))

        expect(result).toMatchObject({ canWrite: true, status: 'active' })
    })
})

describe('plan override - only ever raises', () => {
    it('raises limits and features while the customer is writable', () => {
        const result = resolve(base({ adminGrant: override(days(30), { planCode: 'pro' }) }))

        expect(result.canWrite).toBe(true)
        expect(result.planCode).toBe('pro')
        expect(result.features.workspaces).toBe(true)
        expect(result.limits.receiptStorageBytes).toBe(10_000)
    })

    it('raises a single limit and leaves the rest', () => {
        const result = resolve(base({ adminGrant: override(days(30), { limits: { receiptStorageBytes: 5000 } }) }), null)

        expect(result.limits).toEqual({ ...PLUS.limits, receiptStorageBytes: 5000 })
        expect(result.planCode).toBe('plus')
    })

    it('null means unlimited and beats any number', () => {
        const result = resolve(base({ adminGrant: override(days(30), { limits: { receiptStorageBytes: null } }) }), null)

        expect(result.limits.receiptStorageBytes).toBeNull()
    })

    it('can never lower a limit or drop a feature, even if the grant asks to', () => {
        const result = resolve(base({ planCode: 'pro', adminGrant: override(days(30), { planCode: 'plus', limits: { receiptStorageBytes: 1, workspaceMembers: 0 } }) }), PLUS, PRO)

        expect(result.planCode).toBe('pro')
        expect(result.limits).toEqual(PRO.limits)
        expect(result.features).toEqual(PRO.features)
    })

    it('does not make a read-only customer writable - that is what a comp is for', () => {
        const result = resolve(base({ status: 'trial_expired', trialEndsAt: days(-3), adminGrant: override(days(30), { planCode: 'pro' }) }))

        expect(result.canWrite).toBe(false)
        expect(result.status).toBe('trial_expired')
    })

    it('expires by the clock', () => {
        const subscription = base({ adminGrant: override(days(1), { limits: { receiptStorageBytes: 5000 } }) })

        expect(resolve(subscription, null).limits.receiptStorageBytes).toBe(5000)
        expect(resolve(subscription, null, PLUS, days(1)).limits.receiptStorageBytes).toBe(1000)
    })
})

describe('no grant is no change', () => {
    it('resolves exactly as before when there is no grant, or it has expired', () => {
        const plain = resolveEntitlements(base(), PLUS, NOW)

        expect(resolve(base({ adminGrant: null }), null)).toEqual(plain)
        expect(resolve(base({ adminGrant: comp(days(-1)) }), PRO)).toEqual(plain)
    })
})

describe('isPlanUpgrade', () => {
    it('is true for a higher plan or any raised limit, false for anything that only matches or lowers', () => {
        expect(isPlanUpgrade({ planCode: 'pro' }, PLUS)).toBe(true)
        expect(isPlanUpgrade({ planCode: 'plus' }, PLUS)).toBe(false)
        expect(isPlanUpgrade({ planCode: 'plus' }, PRO)).toBe(false)
        expect(isPlanUpgrade({ limits: { receiptStorageBytes: 2000 } }, PLUS)).toBe(true)
        expect(isPlanUpgrade({ limits: { receiptStorageBytes: 1000 } }, PLUS)).toBe(false)
        expect(isPlanUpgrade({ limits: { receiptStorageBytes: 10 } }, PLUS)).toBe(false)
        expect(isPlanUpgrade({ limits: { syncDevices: null } }, PLUS)).toBe(true)
        expect(isPlanUpgrade({ limits: { syncDevices: null } }, PRO)).toBe(false)
        expect(isPlanUpgrade({}, PLUS)).toBe(false)
    })
})

describe('writableUntil with a grant', () => {
    const snapshot = (subscription: SubscriptionSnapshot, now: Date = NOW) =>
        buildEntitlementSnapshot(resolve(subscription, PRO, PLUS, now), subscription, now)

    it('a comp over a read-only state is writable until the comp ends', () => {
        const result = snapshot(base({ status: 'cancelled', adminGrant: comp(days(10)) }))

        expect(result.canWrite).toBe(true)
        expect(result.writableUntil).toEqual(days(10))
    })

    it('a comp that outlasts a trial or a cancelling period extends the moment write access lapses', () => {
        expect(snapshot(base({ status: 'trialing', trialEndsAt: days(2), currentPeriodEnd: null, adminGrant: comp(days(10)) })).writableUntil).toEqual(days(10))
        expect(snapshot(base({ cancelAtPeriodEnd: true, currentPeriodEnd: days(3), adminGrant: comp(days(10)) })).writableUntil).toEqual(days(10))
    })

    it('a comp that ends before the provider state does changes nothing', () => {
        expect(snapshot(base({ status: 'trialing', trialEndsAt: days(20), currentPeriodEnd: null, adminGrant: comp(days(5)) })).writableUntil).toEqual(days(20))
    })

    it('an open-ended paying subscription stays unbounded whatever the grant', () => {
        expect(snapshot(base({ adminGrant: comp(days(5)) })).writableUntil).toBeNull()
    })

    it('an override does not move it', () => {
        expect(snapshot(base({ status: 'trialing', trialEndsAt: days(2), currentPeriodEnd: null, adminGrant: override(days(30), { planCode: 'pro' }) })).writableUntil).toEqual(days(2))
    })

    it('an expired grant does not move it', () => {
        expect(snapshot(base({ status: 'trialing', trialEndsAt: days(2), currentPeriodEnd: null, adminGrant: comp(days(-1)) })).writableUntil).toEqual(days(2))
    })
})

describe('retention pause', () => {
    it('is paused while a hold or a comp is running, and not once both have ended', () => {
        expect(isRetentionPaused(days(5), null, NOW)).toBe(true)
        expect(isRetentionPaused(null, days(5), NOW)).toBe(true)
        expect(isRetentionPaused(days(-1), days(-2), NOW)).toBe(false)
        expect(isRetentionPaused(null, null, NOW)).toBe(false)
        expect(isRetentionPaused(undefined, undefined, NOW)).toBe(false)
    })

    it('restarts the clock from the latest pause end, never earlier than the lapse', () => {
        expect(retentionClockStart(days(-100), null, null)).toEqual(days(-100))
        expect(retentionClockStart(days(-100), days(-10), null)).toEqual(days(-10))
        expect(retentionClockStart(days(-100), days(-10), days(-5))).toEqual(days(-5))
        expect(retentionClockStart(days(-100), days(-200), days(-300))).toEqual(days(-100))
    })
})
