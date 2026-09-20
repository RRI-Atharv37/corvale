import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'

import app from '@http/app'
import { Account } from '@modules/accounts'
import { Subscription, expireLapsedTrials, startTrialIfEligible } from '@modules/billing'
import { TRIAL_LENGTH_DAYS, TRIAL_PLAN_CODE } from '@core/billing/entitlements'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { authHeader, registerUser } from '@tests/helpers'
import {
    DAY_MS,
    daysFromNow,
    disableBilling,
    enableBilling,
    seedTestPlans,
    setSubscription,
} from '@tests/billingHelpers'

/**
 * M1 - trial expiry transitions (M5): `trialing -> trial_expired`, read-only and never deletion.
 * Expiry is *derived* at request time from trialEndsAt (so it holds even if the sweep job is
 * down) and *persisted* by `expireLapsedTrials`, which must be idempotent and touch nothing else.
 */

beforeEach(async () => {
    enableBilling()
    await seedTestPlans()
})

afterEach(() => disableBilling())

const createAccount = (token: string, name = 'Checking') =>
    request(app).post('/api/v1/accounts').set(authHeader(token)).send({ name, type: 'checking', openingBalance: 5 })

describe('starting a trial at signup (no card up front)', () => {
    it('registering with billing on creates a 30-day trial on the trial plan', async () => {
        const before = Date.now()
        const user = await registerUser(app)

        const sub = await Subscription.findOne({ userId: user.userId }).lean()

        expect(sub?.status).toBe('trialing')
        expect(sub?.planCode).toBe(TRIAL_PLAN_CODE)
        expect(sub?.grandfatherKind).toBeNull()
        expect(sub?.providerCustomerId ?? null).toBeNull()
        const trialMs = (sub?.trialEndsAt as Date).getTime() - before
        expect(trialMs).toBeGreaterThan(TRIAL_LENGTH_DAYS * DAY_MS - 60_000)
        expect(trialMs).toBeLessThan(TRIAL_LENGTH_DAYS * DAY_MS + 60_000)
    })

    it('a fresh signup can write straight away and sees status=trialing in /auth/user', async () => {
        const user = await registerUser(app)

        expect((await createAccount(user.token)).status).toBe(201)

        const me = await request(app).get('/api/v1/auth/user').set(authHeader(user.token))
        expect(me.body.data.entitlements.status).toBe('trialing')
        expect(me.body.data.entitlements.canWrite).toBe(true)
    })

    it('startTrialIfEligible is a no-op when any subscription row already exists (no trial farming)', async () => {
        const userId = new Types.ObjectId().toString()
        await setSubscription(userId, { status: 'trial_expired', trialEndsAt: daysFromNow(-3), currentPeriodEnd: null })

        const started = await startTrialIfEligible(userId)

        expect(started).toBe(false)
        const sub = await Subscription.findOne({ userId }).lean()
        expect(sub?.status).toBe('trial_expired')
    })

    it('startTrialIfEligible creates exactly one trial however often it is called', async () => {
        const userId = new Types.ObjectId().toString()
        const now = new Date('2026-10-01T00:00:00.000Z')

        expect(await startTrialIfEligible(userId, now)).toBe(true)
        expect(await startTrialIfEligible(userId, new Date('2026-10-20T00:00:00.000Z'))).toBe(false)

        const subs = await Subscription.find({ userId }).lean()
        expect(subs).toHaveLength(1)
        expect((subs[0].trialEndsAt as Date).getTime()).toBe(now.getTime() + TRIAL_LENGTH_DAYS * DAY_MS)
    })
})

describe('trial expiry - derived at request time', () => {
    it('writes work on the last day and are refused once trialEndsAt passes, with no job having run', async () => {
        const user = await registerUser(app)

        await setSubscription(user.userId, { status: 'trialing', trialEndsAt: new Date(Date.now() + 60_000), currentPeriodEnd: null })
        expect((await createAccount(user.token, 'Last day')).status).toBe(201)

        await setSubscription(user.userId, { status: 'trialing', trialEndsAt: new Date(Date.now() - 1_000), currentPeriodEnd: null })
        const refused = await createAccount(user.token, 'Too late')

        expect(refused.status).toBe(402)
        expect(refused.body.message).toBe(ERROR_MESSAGES.BILLING.READ_ONLY)
        const me = await request(app).get('/api/v1/auth/user').set(authHeader(user.token))
        expect(me.body.data.entitlements.status).toBe('trial_expired')
    })

    it('expiry deletes nothing: the trial-period data is still readable afterwards', async () => {
        const user = await registerUser(app)
        await createAccount(user.token, 'Made during trial')
        await setSubscription(user.userId, { status: 'trialing', trialEndsAt: daysFromNow(-1), currentPeriodEnd: null })

        const res = await request(app).get('/api/v1/accounts').set(authHeader(user.token))

        expect(res.status).toBe(200)
        expect(JSON.stringify(res.body)).toContain('Made during trial')
        expect(await Account.countDocuments({ userId: user.userId })).toBe(1)
    })

    it('becoming a paying subscriber restores writes on the same account with the data intact', async () => {
        const user = await registerUser(app)
        await createAccount(user.token, 'Before')
        await setSubscription(user.userId, { status: 'trialing', trialEndsAt: daysFromNow(-1), currentPeriodEnd: null })
        expect((await createAccount(user.token, 'Blocked')).status).toBe(402)

        await setSubscription(user.userId, { status: 'active', planCode: 'plus' })

        expect((await createAccount(user.token, 'After')).status).toBe(201)
        expect(await Account.countDocuments({ userId: user.userId })).toBe(2)
    })
})

describe('expireLapsedTrials - the persisting sweep', () => {
    const seedTrial = async (endsInDays: number, extra: Record<string, unknown> = {}) => {
        const userId = new Types.ObjectId().toString()
        await setSubscription(userId, {
            status: 'trialing',
            trialEndsAt: daysFromNow(endsInDays),
            currentPeriodEnd: null,
            ...extra,
        })
        return userId
    }

    it('persists trial_expired for lapsed trials and leaves running trials alone', async () => {
        const lapsed = await seedTrial(-2)
        const running = await seedTrial(5)

        const result = await expireLapsedTrials()

        expect(result.expired).toBe(1)
        expect((await Subscription.findOne({ userId: lapsed }).lean())?.status).toBe('trial_expired')
        expect((await Subscription.findOne({ userId: running }).lean())?.status).toBe('trialing')
    })

    it('is idempotent', async () => {
        await seedTrial(-2)

        expect((await expireLapsedTrials()).expired).toBe(1)
        expect((await expireLapsedTrials()).expired).toBe(0)
    })

    it('treats `now` as the clock: a trial ending exactly at `now` is expired, one ms later is not', async () => {
        const userId = await seedTrial(0, { trialEndsAt: new Date('2026-11-01T00:00:00.000Z') })

        expect((await expireLapsedTrials(new Date('2026-10-31T23:59:59.999Z'))).expired).toBe(0)
        expect((await expireLapsedTrials(new Date('2026-11-01T00:00:00.000Z'))).expired).toBe(1)
        expect((await Subscription.findOne({ userId }).lean())?.status).toBe('trial_expired')
    })

    it('never touches paying, cancelled, past_due or grandfathered subscriptions', async () => {
        const active = new Types.ObjectId().toString()
        const pastDue = new Types.ObjectId().toString()
        const cancelled = new Types.ObjectId().toString()
        const grandfathered = await seedTrial(-30, { grandfatherKind: 'free_forever' })
        await setSubscription(active, { status: 'active', trialEndsAt: daysFromNow(-30) })
        await setSubscription(pastDue, { status: 'past_due', pastDueSince: daysFromNow(-1), trialEndsAt: daysFromNow(-30) })
        await setSubscription(cancelled, { status: 'cancelled', trialEndsAt: daysFromNow(-30) })

        await expireLapsedTrials()

        expect((await Subscription.findOne({ userId: active }).lean())?.status).toBe('active')
        expect((await Subscription.findOne({ userId: pastDue }).lean())?.status).toBe('past_due')
        expect((await Subscription.findOne({ userId: cancelled }).lean())?.status).toBe('cancelled')
        expect((await Subscription.findOne({ userId: grandfathered }).lean())?.status).toBe('trialing')
    })

    it('an extended_trial keeps its own, later trialEndsAt', async () => {
        const userId = await seedTrial(20, { grandfatherKind: 'extended_trial' })

        await expireLapsedTrials()

        expect((await Subscription.findOne({ userId }).lean())?.status).toBe('trialing')
    })

    it('does nothing at all while billing is off', async () => {
        disableBilling()
        const lapsed = await seedTrial(-2)

        const result = await expireLapsedTrials()

        expect(result.expired).toBe(0)
        expect((await Subscription.findOne({ userId: lapsed }).lean())?.status).toBe('trialing')
    })
})
