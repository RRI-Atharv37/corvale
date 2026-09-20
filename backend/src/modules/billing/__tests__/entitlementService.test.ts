import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Types } from 'mongoose'

import {
    DEFAULT_PLAN_CATALOGUE,
    Plan,
    Subscription,
    UsageCounter,
    getUsage,
    getUserEntitlements,
    isBillingEnabled,
} from '@modules/billing'
import { UNLIMITED_ENTITLEMENTS } from '@core/billing/entitlements'

/**
 * M2b - the Mongoose-aware wrapper around the pure resolver. Entitlements are read fresh from the
 * database on every call (an upgrade or downgrade must apply on the very next request), and the
 * whole thing is inert while BILLING_ENABLED is unset.
 */

const DAY = 24 * 60 * 60 * 1000
const userId = (): string => new Types.ObjectId().toString()

const seedPlans = async (): Promise<void> => {
    await Plan.create([
        {
            code: 'plus',
            name: 'Plus',
            features: { workspaces: false, prioritySupport: false, bankSync: false },
            limits: { receiptStorageBytes: 100, syncDevices: 1, workspaceMembers: null },
        },
        {
            code: 'pro',
            name: 'Pro',
            features: { workspaces: true, prioritySupport: true, bankSync: true },
            limits: { receiptStorageBytes: 1000, syncDevices: null, workspaceMembers: 5 },
        },
    ])
}

const subscribe = (uid: string, fields: Record<string, unknown> = {}) =>
    Subscription.create({
        userId: uid,
        planCode: 'plus',
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * DAY),
        ...fields,
    })

afterEach(() => {
    delete process.env.BILLING_ENABLED
})

describe('isBillingEnabled', () => {
    it('is off unless BILLING_ENABLED is exactly "true"', () => {
        expect(isBillingEnabled()).toBe(false)

        for (const value of ['1', 'TRUE', 'yes', 'false', '']) {
            process.env.BILLING_ENABLED = value
            expect(isBillingEnabled(), value).toBe(false)
        }

        process.env.BILLING_ENABLED = 'true'
        expect(isBillingEnabled()).toBe(true)
    })
})

describe('getUserEntitlements - billing disabled', () => {
    it('returns the unlimited entitlements without touching the database', async () => {
        const uid = userId()
        await seedPlans()
        await subscribe(uid, { status: 'trial_expired', trialEndsAt: new Date(Date.now() - DAY) })

        expect(await getUserEntitlements(uid)).toEqual(UNLIMITED_ENTITLEMENTS)
    })

    it('returns a fresh copy, so a caller mutating it cannot poison the shared constant', async () => {
        const first = await getUserEntitlements(userId())
        first.features.workspaces = false
        first.limits.syncDevices = 0

        expect(UNLIMITED_ENTITLEMENTS.features.workspaces).toBe(true)
        expect(UNLIMITED_ENTITLEMENTS.limits.syncDevices).toBeNull()
    })
})

describe('getUserEntitlements - billing enabled', () => {
    beforeEach(() => {
        process.env.BILLING_ENABLED = 'true'
    })

    it('a user with no subscription is read-only', async () => {
        await seedPlans()

        const e = await getUserEntitlements(userId())

        expect(e.billingEnabled).toBe(true)
        expect(e.status).toBe('none')
        expect(e.canWrite).toBe(false)
        expect(e.canRead).toBe(true)
    })

    it('resolves the subscription against its plan row', async () => {
        const uid = userId()
        await seedPlans()
        await subscribe(uid, { planCode: 'pro' })

        const e = await getUserEntitlements(uid)

        expect(e.status).toBe('active')
        expect(e.planCode).toBe('pro')
        expect(e.features.workspaces).toBe(true)
        expect(e.limits.workspaceMembers).toBe(5)
    })

    it('derives expiry from the clock argument, with no sweep having run', async () => {
        const uid = userId()
        await seedPlans()
        const trialEndsAt = new Date(Date.now() + 5 * DAY)
        await subscribe(uid, { planCode: 'pro', status: 'trialing', trialEndsAt, currentPeriodEnd: null })

        expect((await getUserEntitlements(uid)).canWrite).toBe(true)
        expect((await getUserEntitlements(uid, new Date(trialEndsAt.getTime() + 1))).status).toBe('trial_expired')
    })

    it('reads fresh state on every call: an upgrade applies immediately', async () => {
        const uid = userId()
        await seedPlans()
        await subscribe(uid, { planCode: 'plus' })
        expect((await getUserEntitlements(uid)).features.workspaces).toBe(false)

        await Subscription.updateOne({ userId: uid }, { $set: { planCode: 'pro' } })

        expect((await getUserEntitlements(uid)).features.workspaces).toBe(true)
    })

    it('a plan edited in the database applies immediately', async () => {
        const uid = userId()
        await seedPlans()
        await subscribe(uid, { planCode: 'plus' })

        await Plan.updateOne({ code: 'plus' }, { $set: { 'limits.syncDevices': 3 } })

        expect((await getUserEntitlements(uid)).limits.syncDevices).toBe(3)
    })

    it('falls back to the launch catalogue when the plan row is missing, rather than locking the user out', async () => {
        const uid = userId()
        await subscribe(uid, { planCode: 'pro' })
        const pro = DEFAULT_PLAN_CATALOGUE.find((p) => p.code === 'pro')

        const e = await getUserEntitlements(uid)

        expect(e.canWrite).toBe(true)
        expect(e.features).toEqual(pro?.features)
        expect(e.limits).toEqual(pro?.limits)
    })

    it('only ever reads the requested user', async () => {
        const [a, b] = [userId(), userId()]
        await seedPlans()
        await subscribe(a, { planCode: 'pro' })
        await subscribe(b, { planCode: 'plus' })

        expect((await getUserEntitlements(a)).planCode).toBe('pro')
        expect((await getUserEntitlements(b)).planCode).toBe('plus')
    })
})

describe('getUsage', () => {
    it('is zero when no counter exists', async () => {
        expect(await getUsage(userId(), 'receiptBytes')).toBe(0)
    })

    it('reads the counter for that user and resource only', async () => {
        const [a, b] = [userId(), userId()]
        await UsageCounter.create([
            { userId: a, resource: 'receiptBytes', value: 40 },
            { userId: a, resource: 'syncDevices', value: 2 },
            { userId: b, resource: 'receiptBytes', value: 999 },
        ])

        expect(await getUsage(a, 'receiptBytes')).toBe(40)
        expect(await getUsage(a, 'syncDevices')).toBe(2)
        expect(await getUsage(a, 'workspaceMembers')).toBe(0)
    })
})
