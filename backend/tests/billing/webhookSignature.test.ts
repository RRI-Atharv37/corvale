import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { BillingEvent, Subscription } from '@modules/billing'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { registerUser, type RegisteredUser } from '@tests/helpers'
import {
    WEBHOOK_PATH,
    WEBHOOK_SECRET,
    SIGNATURE_HEADER,
    BILLING_STATES,
    buildEvent,
    disableBilling,
    enableBilling,
    installFakeBillingProvider,
    postWebhook,
    resetBillingProvider,
    seedTestPlans,
    setSubscription,
    signPayload,
    type FakeProviderCalls,
} from '@tests/billingHelpers'

/**
 * M1 - webhook signature rejection (M3b, non-negotiable #1): the signature is verified over the
 * RAW request bytes BEFORE anything is parsed; an unsigned or mis-signed delivery is 400 and
 * leaves no trace - no ledger row, no state change, and the provider's `parseEvent` never runs.
 * The route is unauthenticated by design and exempt from the normal limiter. Driven through a
 * fake provider, so nothing here depends on which Merchant of Record M0 selects.
 */

let user: RegisteredUser
let calls: FakeProviderCalls

const upgradeEvent = () =>
    buildEvent({
        type: 'subscription.updated',
        providerCustomerId: `cus_${user.userId}`,
        providerSubscriptionId: `sub_${user.userId}`,
        planCode: 'plus',
        status: 'active',
    })

beforeEach(async () => {
    enableBilling()
    await seedTestPlans()
    calls = installFakeBillingProvider()
    user = await registerUser(app)
    await setSubscription(user.userId, BILLING_STATES.trialing)
})

afterEach(() => {
    disableBilling()
    resetBillingProvider()
})

const expectNoTrace = async () => {
    expect(await BillingEvent.countDocuments({})).toBe(0)
    const sub = await Subscription.findOne({ userId: user.userId }).lean()
    expect(sub?.status).toBe('trialing')
    expect(sub?.planCode).toBe('pro')
}

describe('webhook - signature verification', () => {
    it('accepts a correctly signed delivery with no auth header', async () => {
        const res = await postWebhook(app, upgradeEvent())

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
    })

    it('rejects a delivery with no signature header: 400, no trace', async () => {
        const res = await postWebhook(app, upgradeEvent(), { signature: null })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.WEBHOOK_SIGNATURE_INVALID)
        await expectNoTrace()
    })

    it('rejects a signature made with the wrong secret', async () => {
        const res = await postWebhook(app, upgradeEvent(), { secret: 'not-the-secret' })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.WEBHOOK_SIGNATURE_INVALID)
        await expectNoTrace()
    })

    it('rejects a valid signature replayed over a tampered body', async () => {
        const honest = JSON.stringify({ ...upgradeEvent(), planCode: 'plus' })
        const forged = JSON.stringify({ ...upgradeEvent(), planCode: 'pro', status: 'active' })

        const res = await postWebhook(app, forged, { signature: signPayload(honest) })

        expect(res.status).toBe(400)
        await expectNoTrace()
    })

    it.each(['', 'abc', 'zz'.repeat(40), 'A'.repeat(64)])(
        'a malformed signature (%j) is a clean 400, never a 500',
        async (signature) => {
            const res = await postWebhook(app, upgradeEvent(), { signature })

            expect(res.status).toBe(400)
            await expectNoTrace()
        }
    )

    it('verifies BEFORE parsing: a bad signature over an unparseable body is a signature error and parseEvent never runs', async () => {
        const res = await postWebhook(app, '{ this is not json', { secret: 'wrong' })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.WEBHOOK_SIGNATURE_INVALID)
        expect(calls.verifyWebhook).toBe(1)
        expect(calls.parseEvent).toBe(0)
    })

    it('a correctly signed but unparseable body is 400 WEBHOOK_PAYLOAD_INVALID and records nothing', async () => {
        const res = await postWebhook(app, '{ this is not json')

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.WEBHOOK_PAYLOAD_INVALID)
        expect(await BillingEvent.countDocuments({})).toBe(0)
    })

    it('a signed event with no providerEventId cannot be made idempotent, so it is refused', async () => {
        const noId: Record<string, unknown> = { ...upgradeEvent() }
        delete noId.providerEventId

        const res = await postWebhook(app, noId)

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.WEBHOOK_PAYLOAD_INVALID)
    })

    it('a bearer token is irrelevant: a user JWT neither helps nor hurts, and a garbage one does not 401', async () => {
        const raw = JSON.stringify(upgradeEvent())

        const res = await request(app)
            .post(WEBHOOK_PATH)
            .set('content-type', 'application/json')
            .set('authorization', 'Bearer not-a-real-token')
            .set(SIGNATURE_HEADER, signPayload(raw))
            .send(raw)

        expect(res.status).toBe(200)
    })

    it('a user token with no signature cannot move their own subscription', async () => {
        const res = await request(app)
            .post(WEBHOOK_PATH)
            .set('authorization', `Bearer ${user.token}`)
            .send(upgradeEvent())

        expect(res.status).toBe(400)
        await expectNoTrace()
    })
})

describe('webhook - the signature covers the raw bytes, not a re-serialised body', () => {
    it('accepts pretty-printed JSON with unusual whitespace and key order', async () => {
        const raw = JSON.stringify(upgradeEvent(), null, 4).replace(/:/g, ' :  ')

        const res = await postWebhook(app, raw)

        expect(res.status).toBe(200)
    })

    it('is not disturbed by the API-wide body sanitiser: operator-looking keys inside the payload verify fine', async () => {
        const event = { ...upgradeEvent(), metadata: { $set: { x: 1 }, 'a.b': 2 } }

        const res = await postWebhook(app, event)

        expect(res.status).toBe(200)
    })
})

describe('webhook - rate limiting', () => {
    it('is not subject to the general API limiter: a burst above it is never answered 429', async () => {
        const statuses: number[] = []
        const bad = JSON.stringify(upgradeEvent())

        for (let batch = 0; batch < 13; batch += 1) {
            const results = await Promise.all(
                Array.from({ length: 25 }, () => postWebhook(app, bad, { signature: 'bad' }))
            )
            statuses.push(...results.map((r) => r.status))
        }

        expect(statuses).toHaveLength(325)
        expect(statuses.every((s) => s === 400)).toBe(true)
    })
})

describe('webhook - always signature-checked, even with billing switched off', () => {
    it('does not accept unsigned events just because BILLING_ENABLED is unset', async () => {
        disableBilling()

        const res = await postWebhook(app, upgradeEvent(), { signature: null })

        expect(res.status).toBe(400)
    })

    it('the shared secret is never echoed back', async () => {
        const res = await postWebhook(app, upgradeEvent(), { secret: 'wrong' })

        expect(JSON.stringify(res.body)).not.toContain(WEBHOOK_SECRET)
    })
})
