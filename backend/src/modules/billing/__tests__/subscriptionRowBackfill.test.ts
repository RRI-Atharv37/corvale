import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { backfillSubscriptionRows } from '@migrations/subscriptionRowBackfill'
import { authHeader, registerUser, type RegisteredUser } from '@tests/helpers'
import { BILLING_STATES, daysFromNow, disableBilling, enableBilling, seedTestPlans, setSubscription } from '@tests/billingHelpers'

import MetricDaily from '../metricDaily.model'
import Subscription from '../subscription.model'

/**
 * BUG-42 - a user who registered while billing was off has no subscription row, so the moment billing
 * goes on they resolve to `none` and every gated write answers 402, with no admin tool able to reach
 * them. The one-shot backfill, run before the flag is flipped, gives each such user the trial.
 */

const createAccount = (user: RegisteredUser) =>
    request(app).post('/api/v1/accounts').set(authHeader(user.token)).send({ name: 'Checking', type: 'checking', openingBalance: 1000 })

let registered = 0

const registerWhileBillingOff = async (): Promise<RegisteredUser> => {
    disableBilling()
    registered += 1
    const user = await registerUser(app, { email: `rowless-${registered}@example.com` })
    expect(await Subscription.countDocuments({ userId: user.userId })).toBe(0)
    return user
}

beforeEach(async () => {
    await Subscription.deleteMany({})
    await seedTestPlans()
})

afterEach(() => disableBilling())

describe('a row-less user at go-live', () => {
    it('is read-only once billing is on, until the backfill runs', async () => {
        const user = await registerWhileBillingOff()
        enableBilling()

        expect((await createAccount(user)).status).toBe(402)

        await backfillSubscriptionRows()

        expect((await createAccount(user)).status).toBe(201)
    })

    it('gets the 30-day trial a new account gets, and the backfill can run before billing is switched on', async () => {
        const user = await registerWhileBillingOff()

        const result = await backfillSubscriptionRows()

        expect(result).toEqual({ dryRun: false, users: 1, missing: 1, created: 1 })
        const row = await Subscription.findOne({ userId: user.userId }).lean()
        expect(row).toMatchObject({ planCode: 'pro', status: 'trialing', grandfatherKind: null, providerCustomerId: null, providerSubscriptionId: null })
        expect(Math.abs((row?.trialEndsAt?.getTime() ?? 0) - daysFromNow(30).getTime())).toBeLessThan(60_000)
    })

    it('can be grandfathered as it is created', async () => {
        const user = await registerWhileBillingOff()

        await backfillSubscriptionRows({ grandfatherKind: 'free_forever' })

        expect((await Subscription.findOne({ userId: user.userId }).lean())?.grandfatherKind).toBe('free_forever')
    })
})

describe('backfillSubscriptionRows', () => {
    it('a dry run reports what it would create and writes nothing', async () => {
        await registerWhileBillingOff()
        await registerWhileBillingOff()

        const result = await backfillSubscriptionRows({ dryRun: true })

        expect(result).toEqual({ dryRun: true, users: 2, missing: 2, created: 0 })
        expect(await Subscription.countDocuments({})).toBe(0)
    })

    it('leaves every existing row exactly as it is', async () => {
        const paying = await registerWhileBillingOff()
        const lapsed = await registerWhileBillingOff()
        await registerWhileBillingOff()
        await setSubscription(paying.userId, BILLING_STATES.active)
        await setSubscription(lapsed.userId, { ...BILLING_STATES.cancelled, grandfatherKind: 'locked_rate' })
        const before = await Subscription.find({ userId: { $in: [paying.userId, lapsed.userId] } }).sort({ userId: 1 }).lean()

        const result = await backfillSubscriptionRows()

        expect(result).toEqual({ dryRun: false, users: 3, missing: 1, created: 1 })
        expect(await Subscription.find({ userId: { $in: [paying.userId, lapsed.userId] } }).sort({ userId: 1 }).lean()).toEqual(before)
    })

    it('is idempotent: a re-run only picks up users who registered since', async () => {
        await registerWhileBillingOff()
        await backfillSubscriptionRows()
        await registerWhileBillingOff()

        const rerun = await backfillSubscriptionRows()

        expect(rerun).toEqual({ dryRun: false, users: 2, missing: 1, created: 1 })
        expect(await Subscription.countDocuments({})).toBe(2)
    })

    it('does nothing for an empty install', async () => {
        expect(await backfillSubscriptionRows()).toEqual({ dryRun: false, users: 0, missing: 0, created: 0 })
    })

    it('counts the trials it starts', async () => {
        await registerWhileBillingOff()
        await registerWhileBillingOff()

        await backfillSubscriptionRows()

        const days = await MetricDaily.find({}).lean()
        expect(days.reduce((sum, day) => sum + (day.flows?.trialStarted ?? 0), 0)).toBe(2)
    })

    it('does not count a grandfathered row as a started trial', async () => {
        await registerWhileBillingOff()

        await backfillSubscriptionRows({ grandfatherKind: 'free_forever' })

        const days = await MetricDaily.find({}).lean()
        expect(days.reduce((sum, day) => sum + (day.flows?.trialStarted ?? 0), 0)).toBe(0)
    })
})
