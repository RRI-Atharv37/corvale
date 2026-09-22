import { Types } from 'mongoose'
import request from 'supertest'
import type { Application } from 'express'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import defaultApp from '@http/app'
import { registerUser, type RegisteredUser } from '@tests/helpers'
import { disableBilling, enableBilling, resetBillingProvider, seedTestPlans, setSubscription } from '@tests/billingHelpers'
import { ADMIN_BASE, bearer, buildAdminApp, disableAdmin, loginAsAdmin, seedAdmin } from '@tests/adminHelpers'
import { AdminAuditLog, GrandfatherBatch } from '@modules/admin'
import { Subscription } from '@modules/billing'

import { getGrandfatherCohortReport } from '../adminGrandfatherReport.service'

/**
 * M7b.3 - the grandfather cohort report the plan's dashboard (§7, §10) asks for: everyone a
 * single-user `grandfather.set` audit row or a bulk `GrandfatherBatch` ever touched, classified by
 * their *current* subscription state (free_forever / active_grant / converted / lapsed), plus the
 * still-grandfathered buckets' monthly list-price value foregone. No historical MRR is tracked, so
 * "converted"/"lapsed" read off state today, not a point-in-time snapshot.
 */

let app: Application
let member: RegisteredUser

beforeAll(() => {
    app = buildAdminApp()
})

afterAll(() => {
    disableAdmin()
})

beforeEach(async () => {
    enableBilling()
    await seedTestPlans()
    member = await registerUser(defaultApp)
})

afterEach(() => {
    disableBilling()
    resetBillingProvider()
})

const subscriptionIdFor = async (userId: string): Promise<Types.ObjectId> => {
    const sub = await Subscription.findOne({ userId }).select('_id').lean()
    return sub!._id
}

describe('access', () => {
    it('is readable by finance and owner, not support, and needs a token', async () => {
        const finance = await seedAdmin({ role: 'finance' })
        const { token: financeToken } = await loginAsAdmin(app, finance)
        const owner = await seedAdmin({ role: 'owner' })
        const { token: ownerToken } = await loginAsAdmin(app, owner)
        const support = await seedAdmin({ role: 'support' })
        const { token: supportToken } = await loginAsAdmin(app, support)

        const get = (token: string) => request(app).get(`${ADMIN_BASE}/metrics/grandfather-cohort`).set(bearer(token))

        expect((await get(financeToken)).status).toBe(200)
        expect((await get(ownerToken)).status).toBe(200)
        expect((await get(supportToken)).status).toBe(403)
        expect((await request(app).get(`${ADMIN_BASE}/metrics/grandfather-cohort`)).status).toBe(401)
    })
})

describe('getGrandfatherCohortReport', () => {
    it('reports zero everywhere when nobody has ever been grandfathered', async () => {
        await setSubscription(member.userId, { status: 'active' })

        const result = await getGrandfatherCohortReport()

        expect(result.totalEverGrandfathered).toBe(0)
        expect(result.buckets.every((bucket) => bucket.count === 0 && bucket.foregoneMrrMinor === 0)).toBe(true)
    })

    it('buckets a single-user grandfather (still active) as free_forever, with its plan MRR foregone', async () => {
        await setSubscription(member.userId, { status: 'trial_expired', providerCustomerId: null, providerSubscriptionId: null, grandfatherKind: 'free_forever', planCode: 'pro' })
        await AdminAuditLog.create({
            action: 'grandfather.set',
            subjectUserId: member.userId,
            subjectSubscriptionId: await subscriptionIdFor(member.userId),
            reason: 'Pre-paywall cohort member',
            at: new Date(),
        })

        const result = await getGrandfatherCohortReport()

        expect(result.totalEverGrandfathered).toBe(1)
        const freeForever = result.buckets.find((bucket) => bucket.outcome === 'free_forever')!
        expect(freeForever.count).toBe(1)
        expect(freeForever.foregoneMrrMinor).toBeGreaterThan(0)
    })

    it('buckets a since-revoked grant as converted once the user is really paying, and lapsed otherwise', async () => {
        const converted = await registerUser(defaultApp)
        const lapsed = await registerUser(defaultApp)
        await setSubscription(converted.userId, { status: 'active', grandfatherKind: null })
        await setSubscription(lapsed.userId, { status: 'cancelled', providerCustomerId: null, providerSubscriptionId: null, grandfatherKind: null })

        await GrandfatherBatch.create({
            kind: 'locked_rate',
            registeredBefore: new Date('2026-01-01'),
            reason: 'Bulk cohort, since reverted',
            status: 'reverted',
            subscriptionIds: [await subscriptionIdFor(converted.userId), await subscriptionIdFor(lapsed.userId)],
            createdBy: new Types.ObjectId(),
        })

        const result = await getGrandfatherCohortReport()

        expect(result.totalEverGrandfathered).toBe(2)
        expect(result.buckets.find((bucket) => bucket.outcome === 'converted')!.count).toBe(1)
        expect(result.buckets.find((bucket) => bucket.outcome === 'lapsed')!.count).toBe(1)
    })

    it('counts a subscription only once even if both a single-user record and a batch reference it', async () => {
        await setSubscription(member.userId, { status: 'trial_expired', providerCustomerId: null, providerSubscriptionId: null, grandfatherKind: 'extended_trial' })
        const subId = await subscriptionIdFor(member.userId)
        await AdminAuditLog.create({ action: 'grandfather.set', subjectUserId: member.userId, subjectSubscriptionId: subId, reason: 'first set', at: new Date() })
        await GrandfatherBatch.create({
            kind: 'extended_trial',
            registeredBefore: new Date('2026-01-01'),
            reason: 'Also touched by a bulk batch',
            status: 'applied',
            subscriptionIds: [subId],
            createdBy: new Types.ObjectId(),
        })

        const result = await getGrandfatherCohortReport()

        expect(result.totalEverGrandfathered).toBe(1)
    })
})
