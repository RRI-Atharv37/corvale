import { describe, it, expect } from 'vitest'

import {
    DEFAULT_PAST_DUE_GRACE_DAYS,
    TRIAL_LENGTH_DAYS,
    TRIAL_PLAN_CODE,
    UNLIMITED_ENTITLEMENTS,
    buildTrialSubscription,
    resolveEntitlements,
    type PlanDefinition,
    type SubscriptionSnapshot,
} from '@core/billing/entitlements'

/**
 * M1 - the pure entitlement resolver (M2b): `(subscription, plan, now, options?) => Entitlements`.
 * No Mongoose, no `req`, no clock of its own - every transition below is driven by the `now`
 * argument, so trial expiry and dunning are derived, never dependent on a job having run.
 * The governing rule (ROADMAP § *Trial and downgrade semantics*): read, export and sync-pull are
 * true in EVERY state; only writes and sync-push ever switch off.
 */

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-15T12:00:00.000Z')
const at = (days: number): Date => new Date(NOW.getTime() + days * DAY)

const PLUS: PlanDefinition = {
    code: 'plus',
    features: { workspaces: false, prioritySupport: false, bankSync: false },
    limits: { receiptStorageBytes: 1_000, syncDevices: 1, workspaceMembers: null },
}

const PRO: PlanDefinition = {
    code: 'pro',
    features: { workspaces: true, prioritySupport: true, bankSync: true },
    limits: { receiptStorageBytes: 10_000, syncDevices: null, workspaceMembers: null },
}

const sub = (overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot => ({
    planCode: 'pro',
    status: 'active',
    trialEndsAt: null,
    currentPeriodEnd: at(20),
    cancelAtPeriodEnd: false,
    pastDueSince: null,
    grandfatherKind: null,
    ...overrides,
})

describe('resolveEntitlements - constants', () => {
    it('pins the 30-day, no-card trial', () => {
        expect(TRIAL_LENGTH_DAYS).toBe(30)
    })

    it('has a positive whole-day default dunning grace window', () => {
        expect(Number.isInteger(DEFAULT_PAST_DUE_GRACE_DAYS)).toBe(true)
        expect(DEFAULT_PAST_DUE_GRACE_DAYS).toBeGreaterThan(0)
    })

    it('buildTrialSubscription starts a trial on the trial plan ending exactly TRIAL_LENGTH_DAYS out', () => {
        const trial = buildTrialSubscription(NOW)

        expect(trial.status).toBe('trialing')
        expect(trial.planCode).toBe(TRIAL_PLAN_CODE)
        expect(trial.trialEndsAt?.getTime()).toBe(NOW.getTime() + TRIAL_LENGTH_DAYS * DAY)
        expect(trial.grandfatherKind).toBeNull()
    })
})

describe('resolveEntitlements - status derivation', () => {
    it('trialing inside the window: full write access with the plan features', () => {
        const e = resolveEntitlements(sub({ status: 'trialing', trialEndsAt: at(5), currentPeriodEnd: null }), PRO, NOW)

        expect(e.status).toBe('trialing')
        expect(e.canWrite).toBe(true)
        expect(e.canSyncPush).toBe(true)
        expect(e.features.workspaces).toBe(true)
        expect(e.trialEndsAt).toEqual(at(5))
    })

    it('trial expiry is derived from `now`: one millisecond before trialEndsAt is still trialing', () => {
        const trialEndsAt = at(3)
        const e = resolveEntitlements(
            sub({ status: 'trialing', trialEndsAt }),
            PRO,
            new Date(trialEndsAt.getTime() - 1)
        )

        expect(e.status).toBe('trialing')
        expect(e.canWrite).toBe(true)
    })

    it('a stored `trialing` row flips to trial_expired at trialEndsAt with no job having run', () => {
        const trialEndsAt = at(3)
        const e = resolveEntitlements(sub({ status: 'trialing', trialEndsAt }), PRO, trialEndsAt)

        expect(e.status).toBe('trial_expired')
        expect(e.canWrite).toBe(false)
        expect(e.canSyncPush).toBe(false)
    })

    it('a persisted trial_expired row is read-only', () => {
        const e = resolveEntitlements(sub({ status: 'trial_expired', trialEndsAt: at(-2) }), PRO, NOW)

        expect(e.status).toBe('trial_expired')
        expect(e.canWrite).toBe(false)
    })

    it('active is fully writable', () => {
        const e = resolveEntitlements(sub(), PLUS, NOW)

        expect(e.status).toBe('active')
        expect(e.canWrite).toBe(true)
        expect(e.canSyncPush).toBe(true)
    })

    it('an active subscription set to cancel keeps write access until currentPeriodEnd, then becomes cancelled', () => {
        const cancelling = sub({ cancelAtPeriodEnd: true, currentPeriodEnd: at(4) })

        const before = resolveEntitlements(cancelling, PRO, NOW)
        expect(before.status).toBe('active')
        expect(before.canWrite).toBe(true)
        expect(before.cancelAtPeriodEnd).toBe(true)

        const after = resolveEntitlements(cancelling, PRO, at(4))
        expect(after.status).toBe('cancelled')
        expect(after.canWrite).toBe(false)
    })

    it('a stored cancelled row is read-only', () => {
        const e = resolveEntitlements(sub({ status: 'cancelled', currentPeriodEnd: at(-1) }), PRO, NOW)

        expect(e.status).toBe('cancelled')
        expect(e.canWrite).toBe(false)
    })

    it('an active row past its currentPeriodEnd with no cancellation is still trusted (reconciliation owns drift)', () => {
        const e = resolveEntitlements(sub({ currentPeriodEnd: at(-2) }), PRO, NOW)

        expect(e.status).toBe('active')
        expect(e.canWrite).toBe(true)
    })

    it('past_due keeps write access inside the grace window and drops it once elapsed', () => {
        const pastDue = sub({ status: 'past_due', pastDueSince: at(-2) })

        const inside = resolveEntitlements(pastDue, PRO, NOW, { pastDueGraceDays: 5 })
        expect(inside.status).toBe('past_due')
        expect(inside.canWrite).toBe(true)
        expect(inside.graceEndsAt).toEqual(at(3))

        const elapsed = resolveEntitlements(pastDue, PRO, at(3), { pastDueGraceDays: 5 })
        expect(elapsed.status).toBe('past_due')
        expect(elapsed.canWrite).toBe(false)
        expect(elapsed.canSyncPush).toBe(false)
    })

    it('past_due with no pastDueSince fails toward access, never toward a lockout', () => {
        const e = resolveEntitlements(sub({ status: 'past_due', pastDueSince: null }), PRO, NOW)

        expect(e.canWrite).toBe(true)
    })

    it('no subscription at all (billing on) is read-only with no plan features', () => {
        const e = resolveEntitlements(null, null, NOW)

        expect(e.status).toBe('none')
        expect(e.planCode).toBeNull()
        expect(e.canWrite).toBe(false)
        expect(e.features).toEqual({ workspaces: false, prioritySupport: false, bankSync: false })
    })
})

describe('resolveEntitlements - plans', () => {
    it('Plus and Pro resolve their own features and limits', () => {
        const plus = resolveEntitlements(sub({ planCode: 'plus' }), PLUS, NOW)
        expect(plus.planCode).toBe('plus')
        expect(plus.features.workspaces).toBe(false)
        expect(plus.limits.syncDevices).toBe(1)
        expect(plus.limits.receiptStorageBytes).toBe(1_000)

        const pro = resolveEntitlements(sub({ planCode: 'pro' }), PRO, NOW)
        expect(pro.planCode).toBe('pro')
        expect(pro.features.workspaces).toBe(true)
        expect(pro.limits.syncDevices).toBeNull()
        expect(pro.limits.receiptStorageBytes).toBe(10_000)
    })

    it('a read-only state keeps reporting the plan features so the UI can show what a resubscribe restores', () => {
        const e = resolveEntitlements(sub({ status: 'cancelled', currentPeriodEnd: at(-1) }), PRO, NOW)

        expect(e.canWrite).toBe(false)
        expect(e.features.workspaces).toBe(true)
    })
})

describe('resolveEntitlements - grandfathering (decision #7 stays open)', () => {
    it('free_forever is fully writable whatever the stored status', () => {
        for (const status of ['trial_expired', 'cancelled', 'past_due'] as const) {
            const e = resolveEntitlements(
                sub({ status, grandfatherKind: 'free_forever', pastDueSince: at(-90), trialEndsAt: at(-90) }),
                PRO,
                NOW
            )

            expect(e.canWrite, status).toBe(true)
            expect(e.status, status).toBe('active')
            expect(e.features.workspaces, status).toBe(true)
        }
    })

    it('locked_rate changes price only - it never widens entitlements', () => {
        const e = resolveEntitlements(
            sub({ status: 'trial_expired', grandfatherKind: 'locked_rate', trialEndsAt: at(-1) }),
            PRO,
            NOW
        )

        expect(e.canWrite).toBe(false)
    })

    it('extended_trial is just a later trialEndsAt on the same state machine', () => {
        const extended = sub({ status: 'trialing', grandfatherKind: 'extended_trial', trialEndsAt: at(60) })

        expect(resolveEntitlements(extended, PRO, NOW).canWrite).toBe(true)
        expect(resolveEntitlements(extended, PRO, at(60)).canWrite).toBe(false)
    })
})

describe('resolveEntitlements - the read/export/pull floor', () => {
    const everyState: Array<[string, SubscriptionSnapshot | null]> = [
        ['trialing', sub({ status: 'trialing', trialEndsAt: at(5) })],
        ['trialing but lapsed', sub({ status: 'trialing', trialEndsAt: at(-1) })],
        ['active', sub()],
        ['past_due in grace', sub({ status: 'past_due', pastDueSince: at(-1) })],
        ['past_due grace elapsed', sub({ status: 'past_due', pastDueSince: at(-90) })],
        ['trial_expired', sub({ status: 'trial_expired', trialEndsAt: at(-9) })],
        ['cancelled', sub({ status: 'cancelled' })],
        ['cancelling, period elapsed', sub({ cancelAtPeriodEnd: true, currentPeriodEnd: at(-1) })],
        ['free_forever', sub({ status: 'cancelled', grandfatherKind: 'free_forever' })],
        ['no subscription', null],
    ]

    it.each(everyState)('%s: read, export and sync-pull are always true', (_name, subscription) => {
        const e = resolveEntitlements(subscription, subscription ? PRO : null, NOW)

        expect(e.canRead).toBe(true)
        expect(e.canExport).toBe(true)
        expect(e.canSyncPull).toBe(true)
    })

    it.each(everyState)('%s: sync-push follows write access exactly', (_name, subscription) => {
        const e = resolveEntitlements(subscription, subscription ? PRO : null, NOW)

        expect(e.canSyncPush).toBe(e.canWrite)
    })
})

describe('resolveEntitlements - purity', () => {
    it('does not mutate frozen inputs and is deterministic for the same `now`', () => {
        const subscription = Object.freeze(sub({ status: 'trialing', trialEndsAt: at(2) }))
        const plan = Object.freeze({ ...PRO, features: Object.freeze({ ...PRO.features }), limits: Object.freeze({ ...PRO.limits }) })

        const first = resolveEntitlements(subscription, plan, NOW)
        const second = resolveEntitlements(subscription, plan, NOW)

        expect(second).toEqual(first)
    })

    it('reads the clock only through `now`', () => {
        const subscription = sub({ status: 'trialing', trialEndsAt: at(2) })

        expect(resolveEntitlements(subscription, PRO, NOW).canWrite).toBe(true)
        expect(resolveEntitlements(subscription, PRO, at(3)).canWrite).toBe(false)
    })
})

describe('UNLIMITED_ENTITLEMENTS (billing disabled / self-hosted)', () => {
    it('grants everything, limits nothing, and says billing is off', () => {
        expect(UNLIMITED_ENTITLEMENTS.billingEnabled).toBe(false)
        expect(UNLIMITED_ENTITLEMENTS.canRead).toBe(true)
        expect(UNLIMITED_ENTITLEMENTS.canWrite).toBe(true)
        expect(UNLIMITED_ENTITLEMENTS.canExport).toBe(true)
        expect(UNLIMITED_ENTITLEMENTS.canSyncPull).toBe(true)
        expect(UNLIMITED_ENTITLEMENTS.canSyncPush).toBe(true)
        expect(UNLIMITED_ENTITLEMENTS.features).toEqual({ workspaces: true, prioritySupport: true, bankSync: true })
        expect(UNLIMITED_ENTITLEMENTS.limits).toEqual({
            receiptStorageBytes: null,
            syncDevices: null,
            workspaceMembers: null,
        })
    })

    it('resolveEntitlements marks resolved results as billingEnabled', () => {
        expect(resolveEntitlements(sub(), PRO, NOW).billingEnabled).toBe(true)
    })
})
