import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { UNLIMITED_ENTITLEMENTS } from '@core/billing/entitlements'
import { authHeader, registerUser, type RegisteredUser } from '@tests/helpers'
import {
    BILLING_STATES,
    disableBilling,
    enableBilling,
    removeSubscription,
    seedTestPlans,
    setSubscription,
} from '@tests/billingHelpers'

/**
 * M2d - the client's entitlement snapshot rides on the user payload (`user.entitlements`), so the
 * frontend needs no extra request. Every endpoint that returns a user must carry it: the client
 * replaces its stored user wholesale with whatever comes back, so one endpoint that omitted it
 * would silently wipe the snapshot.
 */

let user: RegisteredUser

const getUser = () => request(app).get('/api/v1/auth/user').set(authHeader(user.token))

beforeEach(async () => {
    user = await registerUser(app)
})

afterEach(() => disableBilling())

describe('user payload - billing off (self-hosted)', () => {
    it('carries unlimited entitlements', async () => {
        const res = await getUser()

        expect(res.status).toBe(200)
        expect(res.body.data.entitlements).toMatchObject({
            billingEnabled: false,
            canRead: true,
            canWrite: true,
            canExport: true,
            canSyncPush: true,
            writableUntil: null,
            features: UNLIMITED_ENTITLEMENTS.features,
            limits: UNLIMITED_ENTITLEMENTS.limits,
        })
    })
})

describe('user payload - billing on', () => {
    beforeEach(async () => {
        enableBilling()
        await seedTestPlans()
    })

    it("reflects the caller's own plan and status", async () => {
        await setSubscription(user.userId, BILLING_STATES.active)

        const { entitlements } = (await getUser()).body.data

        expect(entitlements.billingEnabled).toBe(true)
        expect(entitlements.planCode).toBe('pro')
        expect(entitlements.status).toBe('active')
        expect(entitlements.canWrite).toBe(true)
        expect(entitlements.features.workspaces).toBe(true)
    })

    it('a user with no subscription is read-only but can still read and export', async () => {
        await removeSubscription(user.userId)

        const { entitlements } = (await getUser()).body.data

        expect(entitlements).toMatchObject({ status: 'none', canRead: true, canWrite: false, canExport: true })
    })

    it('a lapsed subscription reports read-only', async () => {
        await setSubscription(user.userId, BILLING_STATES.trial_expired)

        const { entitlements } = (await getUser()).body.data

        expect(entitlements).toMatchObject({ status: 'trial_expired', canWrite: false, canSyncPush: false, canSyncPull: true })
    })

    it('a trial reports when write access will lapse, as an ISO date', async () => {
        await setSubscription(user.userId, BILLING_STATES.trialing)

        const { entitlements } = (await getUser()).body.data

        expect(entitlements.status).toBe('trialing')
        expect(new Date(entitlements.writableUntil).toISOString()).toBe(entitlements.writableUntil)
        expect(entitlements.writableUntil).toBe(entitlements.trialEndsAt)
    })

    it('stamps when it was resolved', async () => {
        await setSubscription(user.userId, BILLING_STATES.active)
        const before = Date.now()

        const { entitlements } = (await getUser()).body.data

        expect(new Date(entitlements.resolvedAt).getTime()).toBeGreaterThanOrEqual(before - 1000)
        expect(new Date(entitlements.resolvedAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000)
    })

    it('reads fresh state: a change applies to the very next payload', async () => {
        await setSubscription(user.userId, BILLING_STATES.active)
        expect((await getUser()).body.data.entitlements.canWrite).toBe(true)

        await setSubscription(user.userId, BILLING_STATES.cancelled)

        expect((await getUser()).body.data.entitlements.canWrite).toBe(false)
    })

    it('never leaks provider identifiers or grandfather details', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.active, grandfatherKind: 'locked_rate' })

        const body = JSON.stringify((await getUser()).body)

        expect(body).not.toContain(`cus_${user.userId}`)
        expect(body).not.toContain(`sub_${user.userId}`)
        expect(body).not.toContain('grandfather')
        expect(body).not.toContain('providerCustomerId')
    })

})

describe('every endpoint that returns a user carries the snapshot', () => {
    beforeEach(async () => {
        enableBilling()
        await seedTestPlans()
        await setSubscription(user.userId, BILLING_STATES.active)
    })

    it('PATCH /auth/user (preferences)', async () => {
        const res = await request(app).patch('/api/v1/auth/user').set(authHeader(user.token)).send({ fullName: 'Renamed' })

        expect(res.status).toBe(200)
        expect(res.body.data.fullName).toBe('Renamed')
        expect(res.body.data.entitlements).toMatchObject({ planCode: 'pro', canWrite: true })
    })

    it('POST /auth/login', async () => {
        const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'TestPassword123!' })

        expect(res.status).toBe(200)
        expect(res.body.data.user.entitlements).toMatchObject({ planCode: 'pro', canWrite: true })
    })

    it('POST /auth/refresh', async () => {
        const agent = request.agent(app)
        await agent.post('/api/v1/auth/login').send({ email: user.email, password: 'TestPassword123!' })

        const res = await agent.post('/api/v1/auth/refresh')

        expect(res.status).toBe(200)
        expect(res.body.data.user.entitlements).toMatchObject({ planCode: 'pro', canWrite: true })
    })

    it('POST /auth/register', async () => {
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({
                fullName: 'New Person',
                email: 'new-person@example.com',
                password: 'TestPassword123!',
                acceptedTerms: true,
                ageAttested: true,
            })

        expect(res.status).toBeLessThan(300)
        expect(res.body.data.user.entitlements).toMatchObject({ billingEnabled: true, canRead: true })
    })
})
