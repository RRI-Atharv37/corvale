import { describe, it, expect } from 'vitest'

import { USAGE_RESOURCES, LIMIT_KEYS, RESOURCE_LIMIT_KEY } from '@core/billing/constants'
import {
    resolveEntitlements,
    wouldExceedQuota,
    type PlanDefinition,
    type SubscriptionSnapshot,
} from '@core/billing/entitlements'

/**
 * M2b - the pure quota arithmetic and the "subscription without a plan definition" edge, kept
 * beside (not inside) the M1 resolver spec. `null` limit = unlimited; a quota only ever blocks
 * *adding* usage.
 */

const NOW = new Date('2026-10-15T12:00:00.000Z')

const subscription: SubscriptionSnapshot = {
    planCode: 'plus',
    status: 'active',
    trialEndsAt: null,
    currentPeriodEnd: new Date(NOW.getTime() + 86_400_000),
    cancelAtPeriodEnd: false,
    pastDueSince: null,
    grandfatherKind: null,
}

describe('RESOURCE_LIMIT_KEY', () => {
    it('maps every usage resource to a distinct plan limit key', () => {
        const mapped = USAGE_RESOURCES.map((r) => RESOURCE_LIMIT_KEY[r])

        expect(new Set(mapped).size).toBe(USAGE_RESOURCES.length)
        for (const key of mapped) expect(LIMIT_KEYS).toContain(key)
    })

    it('pins the mapping', () => {
        expect(RESOURCE_LIMIT_KEY).toEqual({
            receiptBytes: 'receiptStorageBytes',
            syncDevices: 'syncDevices',
            workspaceMembers: 'workspaceMembers',
        })
    })
})

describe('wouldExceedQuota', () => {
    it('a null limit is unlimited', () => {
        expect(wouldExceedQuota(null, 1_000_000, 1_000_000)).toBe(false)
    })

    it('allows usage that lands exactly on the limit', () => {
        expect(wouldExceedQuota(10, 6, 4)).toBe(false)
        expect(wouldExceedQuota(10, 10, 0)).toBe(false)
    })

    it('refuses usage that passes the limit by even one unit', () => {
        expect(wouldExceedQuota(10, 6, 5)).toBe(true)
        expect(wouldExceedQuota(10, 10, 1)).toBe(true)
    })

    it('a zero limit refuses any addition', () => {
        expect(wouldExceedQuota(0, 0, 1)).toBe(true)
    })

    it('an already over-quota user is refused any addition but not a zero-size request', () => {
        expect(wouldExceedQuota(5, 9, 1)).toBe(true)
        expect(wouldExceedQuota(5, 9, 0)).toBe(false)
    })

    it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('fails closed on an invalid amount (%s)', (amount) => {
        expect(wouldExceedQuota(10, 0, amount)).toBe(true)
        expect(wouldExceedQuota(null, 0, amount)).toBe(true)
    })

    it('fails closed on an invalid usage figure', () => {
        expect(wouldExceedQuota(10, Number.NaN, 1)).toBe(true)
    })
})

describe('resolveEntitlements - subscription present but plan definition missing', () => {
    it('keeps the status-derived write access and the subscription plan code, with no features', () => {
        const e = resolveEntitlements(subscription, null, NOW)

        expect(e.status).toBe('active')
        expect(e.planCode).toBe('plus')
        expect(e.canWrite).toBe(true)
        expect(e.features).toEqual({ workspaces: false, prioritySupport: false, bankSync: false })
    })

    it('a missing plan can never widen limits: every limit is zero, not unlimited', () => {
        const e = resolveEntitlements(subscription, null, NOW)

        expect(e.limits).toEqual({ receiptStorageBytes: 0, syncDevices: 0, workspaceMembers: 0 })
    })
})

describe('resolveEntitlements - no subscription', () => {
    it('reports zero limits so a quota check fails closed', () => {
        const e = resolveEntitlements(null, null, NOW)

        expect(e.limits).toEqual({ receiptStorageBytes: 0, syncDevices: 0, workspaceMembers: 0 })
        expect(e.trialEndsAt).toBeNull()
        expect(e.currentPeriodEnd).toBeNull()
        expect(e.graceEndsAt).toBeNull()
        expect(e.cancelAtPeriodEnd).toBe(false)
    })
})

describe('resolveEntitlements - the result does not alias its inputs', () => {
    it('mutating the returned features/limits leaves the plan definition untouched', () => {
        const plan: PlanDefinition = {
            code: 'plus',
            features: { workspaces: false, prioritySupport: false, bankSync: false },
            limits: { receiptStorageBytes: 1, syncDevices: 1, workspaceMembers: null },
        }

        const e = resolveEntitlements(subscription, plan, NOW)
        e.features.workspaces = true
        e.limits.syncDevices = 99

        expect(plan.features.workspaces).toBe(false)
        expect(plan.limits.syncDevices).toBe(1)
    })
})
