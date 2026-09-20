import { describe, expect, it } from 'vitest'

import type { EntitlementSnapshot } from '@lib/types/api'
import { READ_ONLY_ENTITLEMENTS, resolveClientEntitlements, msUntilWriteLapses } from '@lib/entitlements'

/**
 * M2d - the client's view of the server-issued entitlement snapshot. The governing rule is the
 * offline one from ROADMAP § Entitlement architecture: when the snapshot is missing, unreadable or
 * has aged past its own expiry, fail OPEN TO READ-ONLY - the user keeps reading and exporting their
 * own data - and never fail closed to a locked app. The client gate is UX only; the server enforces.
 */

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-09-20T12:00:00.000Z')
const iso = (days: number): string => new Date(NOW.getTime() + days * DAY).toISOString()

const snapshot = (overrides: Partial<EntitlementSnapshot> = {}): EntitlementSnapshot => ({
    billingEnabled: true,
    status: 'active',
    planCode: 'pro',
    canRead: true,
    canWrite: true,
    canExport: true,
    canSyncPull: true,
    canSyncPush: true,
    features: { workspaces: true, prioritySupport: true, bankSync: true },
    limits: { receiptStorageBytes: 1000, syncDevices: null, workspaceMembers: 3 },
    trialEndsAt: null,
    currentPeriodEnd: iso(30),
    cancelAtPeriodEnd: false,
    graceEndsAt: null,
    resolvedAt: NOW.toISOString(),
    writableUntil: null,
    ...overrides,
})

const expectNeverLocked = (e: EntitlementSnapshot): void => {
    expect(e.canRead).toBe(true)
    expect(e.canExport).toBe(true)
    expect(e.canSyncPull).toBe(true)
}

describe('READ_ONLY_ENTITLEMENTS (the fallback)', () => {
    it('reads, exports and pulls, but does not write or push', () => {
        expectNeverLocked(READ_ONLY_ENTITLEMENTS)
        expect(READ_ONLY_ENTITLEMENTS.canWrite).toBe(false)
        expect(READ_ONLY_ENTITLEMENTS.canSyncPush).toBe(false)
    })

    it('grants no paid features', () => {
        expect(Object.values(READ_ONLY_ENTITLEMENTS.features)).toEqual([false, false, false])
    })

    it('is frozen so a consumer cannot widen it for everyone', () => {
        expect(Object.isFrozen(READ_ONLY_ENTITLEMENTS)).toBe(true)
        expect(Object.isFrozen(READ_ONLY_ENTITLEMENTS.features)).toBe(true)
    })
})

describe('resolveClientEntitlements - no usable snapshot', () => {
    it.each([[undefined], [null], ['active'], [42], [{}], [{ canWrite: true }], [{ ...snapshot(), features: null }]])(
        'falls back to read-only for %j',
        (bad) => {
            const e = resolveClientEntitlements(bad as unknown as EntitlementSnapshot, NOW)

            expect(e).toBe(READ_ONLY_ENTITLEMENTS)
        }
    )
})

describe('resolveClientEntitlements - a usable snapshot', () => {
    it('passes a healthy snapshot through', () => {
        const e = resolveClientEntitlements(snapshot(), NOW)

        expect(e.canWrite).toBe(true)
        expect(e.status).toBe('active')
        expect(e.features.workspaces).toBe(true)
    })

    it('billing off (self-hosted) is unlimited and never expires', () => {
        const e = resolveClientEntitlements(
            snapshot({ billingEnabled: false, planCode: null, writableUntil: null }),
            new Date(NOW.getTime() + 3650 * DAY)
        )

        expect(e.canWrite).toBe(true)
    })

    it('a trial stays writable before it ends', () => {
        const e = resolveClientEntitlements(snapshot({ status: 'trialing', writableUntil: iso(2), trialEndsAt: iso(2) }), NOW)

        expect(e.canWrite).toBe(true)
        expect(e.status).toBe('trialing')
    })

    it.each([
        ['trialing', 'trial_expired'],
        ['active', 'cancelled'],
        ['past_due', 'past_due'],
    ] as const)('a %s snapshot past its writableUntil becomes read-only (%s) without a server call', (status, expected) => {
        const e = resolveClientEntitlements(snapshot({ status, writableUntil: iso(-1) }), NOW)

        expect(e.canWrite).toBe(false)
        expect(e.canSyncPush).toBe(false)
        expect(e.status).toBe(expected)
        expectNeverLocked(e)
    })

    it('lapses exactly at writableUntil, not a moment after', () => {
        const at = snapshot({ status: 'trialing', writableUntil: NOW.toISOString() })

        expect(resolveClientEntitlements(at, NOW).canWrite).toBe(false)
        expect(resolveClientEntitlements(at, new Date(NOW.getTime() - 1)).canWrite).toBe(true)
    })

    it('keeps paid features while read-only, so feature screens stay viewable', () => {
        const e = resolveClientEntitlements(snapshot({ status: 'trialing', writableUntil: iso(-1) }), NOW)

        expect(e.features.workspaces).toBe(true)
    })

    it('never upgrades: a read-only snapshot stays read-only whatever its dates say', () => {
        const e = resolveClientEntitlements(
            snapshot({ status: 'cancelled', canWrite: false, canSyncPush: false, writableUntil: iso(30) }),
            NOW
        )

        expect(e.canWrite).toBe(false)
        expect(e.canSyncPush).toBe(false)
    })

    it('an unparseable writableUntil fails toward read-only, not toward writable', () => {
        const e = resolveClientEntitlements(snapshot({ writableUntil: 'not-a-date' }), NOW)

        expect(e.canWrite).toBe(false)
        expectNeverLocked(e)
    })

    it('forces the never-gated capabilities on, whatever a tampered or corrupted cache says', () => {
        const e = resolveClientEntitlements(
            { ...snapshot(), canRead: false, canExport: false, canSyncPull: false } as unknown as EntitlementSnapshot,
            NOW
        )

        expectNeverLocked(e)
    })

    it('does not mutate the snapshot it was given', () => {
        const input = snapshot({ status: 'trialing', writableUntil: iso(-1) })
        const copy = JSON.parse(JSON.stringify(input))

        resolveClientEntitlements(input, NOW)

        expect(input).toEqual(copy)
    })
})

describe('msUntilWriteLapses', () => {
    it('is the time left until writableUntil', () => {
        expect(msUntilWriteLapses(snapshot({ writableUntil: iso(2) }), NOW)).toBe(2 * DAY)
    })

    it.each([
        ['no writableUntil', snapshot()],
        ['already lapsed', snapshot({ writableUntil: iso(-1) })],
        ['already read-only', snapshot({ canWrite: false, writableUntil: iso(2) })],
        ['billing off', snapshot({ billingEnabled: false, writableUntil: iso(2) })],
        ['unparseable', snapshot({ writableUntil: 'nope' })],
    ])('is null when there is nothing left to wait for (%s)', (_name, s) => {
        expect(msUntilWriteLapses(s, NOW)).toBeNull()
    })

    it('is null for a missing snapshot', () => {
        expect(msUntilWriteLapses(undefined, NOW)).toBeNull()
    })
})
