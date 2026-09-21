import { describe, expect, it } from 'vitest'

import { UNLIMITED_ENTITLEMENTS, cloneEntitlements, resolveEntitlements, type PlanDefinition, type SubscriptionSnapshot } from '../entitlements'
import { explainWriteAccess } from '../readOnlyReason'

/**
 * M7.2 - the plain-language answer to the #1 support question, "why is this user read-only?". It explains the
 * resolver's own verdict, so the text can never disagree with what the API actually does.
 */

const NOW = new Date('2026-09-21T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const days = (n: number): Date => new Date(NOW.getTime() + n * DAY)

const PLAN: PlanDefinition = {
    code: 'pro',
    features: { workspaces: true, prioritySupport: true, bankSync: false },
    limits: { receiptStorageBytes: 1000, syncDevices: null, workspaceMembers: null },
}

const base: SubscriptionSnapshot = {
    planCode: 'pro',
    status: 'active',
    trialEndsAt: null,
    currentPeriodEnd: days(20),
    cancelAtPeriodEnd: false,
    pastDueSince: null,
    grandfatherKind: null,
}

const explain = (overrides: Partial<SubscriptionSnapshot> | null) => {
    const subscription = overrides === null ? null : { ...base, ...overrides }
    return explainWriteAccess(resolveEntitlements(subscription, PLAN, NOW), subscription, NOW)
}

describe('explainWriteAccess - writable', () => {
    it('billing off', () => {
        const result = explainWriteAccess(cloneEntitlements(UNLIMITED_ENTITLEMENTS), null, NOW)

        expect(result).toMatchObject({ canWrite: true, code: 'billing_off' })
    })

    it('an active subscription', () => {
        expect(explain({})).toMatchObject({ canWrite: true, code: 'active' })
    })

    it('a trial names the day it ends', () => {
        const result = explain({ status: 'trialing', trialEndsAt: days(5), currentPeriodEnd: null })

        expect(result).toMatchObject({ canWrite: true, code: 'trialing' })
        expect(result.message).toContain('2026-09-26')
    })

    it('a cancelling subscription says writing ends with the period', () => {
        const result = explain({ cancelAtPeriodEnd: true, currentPeriodEnd: days(4) })

        expect(result).toMatchObject({ canWrite: true, code: 'active_cancelling' })
        expect(result.message).toContain('2026-09-25')
    })

    it('past due inside the grace window names the day it closes', () => {
        const result = explain({ status: 'past_due', pastDueSince: days(-2), currentPeriodEnd: null })

        expect(result).toMatchObject({ canWrite: true, code: 'past_due_in_grace' })
        expect(result.message).toContain('2026-09-26')
    })

    it('a free-forever grandfathered account', () => {
        expect(explain({ grandfatherKind: 'free_forever', status: 'cancelled' })).toMatchObject({ canWrite: true, code: 'free_forever' })
    })
})

describe('explainWriteAccess - read-only', () => {
    it('no subscription row at all', () => {
        const result = explain(null)

        expect(result).toMatchObject({ canWrite: false, code: 'no_subscription' })
        expect(result.message.length).toBeGreaterThan(20)
    })

    it('an expired trial', () => {
        const result = explain({ status: 'trial_expired', trialEndsAt: days(-3), currentPeriodEnd: null })

        expect(result).toMatchObject({ canWrite: false, code: 'trial_expired' })
        expect(result.message).toContain('2026-09-18')
    })

    it('a trial that has run out but not yet been swept is still explained as expired', () => {
        expect(explain({ status: 'trialing', trialEndsAt: days(-1), currentPeriodEnd: null })).toMatchObject({
            canWrite: false,
            code: 'trial_expired',
        })
    })

    it('a cancelled subscription', () => {
        expect(explain({ status: 'cancelled', currentPeriodEnd: days(-10) })).toMatchObject({ canWrite: false, code: 'cancelled' })
    })

    it('a cancel-at-period-end subscription whose period has passed', () => {
        const result = explain({ cancelAtPeriodEnd: true, currentPeriodEnd: days(-1) })

        expect(result).toMatchObject({ canWrite: false, code: 'cancel_period_ended' })
        expect(result.message).toContain('2026-09-20')
    })

    it('past due beyond the grace window', () => {
        const result = explain({ status: 'past_due', pastDueSince: days(-30), currentPeriodEnd: null })

        expect(result).toMatchObject({ canWrite: false, code: 'past_due_grace_ended' })
    })

    it('always says that reading and exporting still work', () => {
        for (const overrides of [null, { status: 'cancelled' as const, currentPeriodEnd: days(-1) }]) {
            expect(explain(overrides).message.toLowerCase()).toContain('export')
        }
    })
})

describe('explainWriteAccess - never contradicts the resolver', () => {
    it.each([
        [null],
        [{}],
        [{ status: 'trialing' as const, trialEndsAt: days(3), currentPeriodEnd: null }],
        [{ status: 'trialing' as const, trialEndsAt: days(-3), currentPeriodEnd: null }],
        [{ status: 'trial_expired' as const }],
        [{ status: 'cancelled' as const }],
        [{ status: 'past_due' as const, pastDueSince: days(-1) }],
        [{ status: 'past_due' as const, pastDueSince: days(-40) }],
        [{ cancelAtPeriodEnd: true, currentPeriodEnd: days(-1) }],
        [{ grandfatherKind: 'free_forever' as const, status: 'trial_expired' as const }],
    ])('canWrite matches for %j', (overrides) => {
        const subscription = overrides === null ? null : { ...base, ...overrides }
        const entitlements = resolveEntitlements(subscription, PLAN, NOW)

        expect(explainWriteAccess(entitlements, subscription, NOW).canWrite).toBe(entitlements.canWrite)
    })
})
