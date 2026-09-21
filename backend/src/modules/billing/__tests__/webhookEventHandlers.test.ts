import { beforeEach, describe, expect, it } from 'vitest'

import app from '@http/app'
import { Subscription, applyBillingEvent, type NormalizedBillingEvent } from '@modules/billing'
import { registerUser, type RegisteredUser } from '@tests/helpers'
import { BILLING_STATES, DAY_MS, daysFromNow, setSubscription } from '@tests/billingHelpers'

/**
 * M3c - the per-event handlers in isolation. The HTTP-level behaviour (entitlement after each event)
 * is pinned by tests/billing/webhookEvents + webhookIdempotency; this file pins the guard rails the
 * routes cannot easily reach: who may link a subscription, what a stale event may not do, and which
 * states a payment event is allowed to move.
 */

let user: RegisteredUser
let other: RegisteredUser

const ids = (u: RegisteredUser = user) => ({
    providerCustomerId: `cus_${u.userId}`,
    providerSubscriptionId: `sub_${u.userId}`,
})

let counter = 0
const event = (overrides: Partial<NormalizedBillingEvent> = {}): NormalizedBillingEvent => {
    counter += 1
    return {
        providerEventId: `evt_handler_${counter}`,
        type: 'subscription.updated',
        occurredAt: new Date(),
        ...ids(),
        ...overrides,
    }
}

const sub = (u: RegisteredUser = user) => Subscription.findOne({ userId: u.userId }).lean()

beforeEach(async () => {
    user = await registerUser(app)
    other = await registerUser(app)
    await Subscription.deleteMany({})
})

describe('linking a subscription to a user', () => {
    it('links an unlinked subscription from the user id on the checkout', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.trial_expired, providerCustomerId: null, providerSubscriptionId: null })

        const outcome = await applyBillingEvent(
            event({ type: 'checkout.completed', userId: user.userId, planCode: 'plus', status: 'active' })
        )

        expect(outcome.status).toBe('applied')
        expect((await sub())?.providerSubscriptionId).toBe(ids().providerSubscriptionId)
    })

    it('never moves an existing provider link, however the event names the user', async () => {
        await setSubscription(user.userId, { status: 'active', providerCustomerId: 'cus_original', providerSubscriptionId: 'sub_original' })

        const outcome = await applyBillingEvent(
            event({ type: 'checkout.completed', userId: user.userId, planCode: 'pro', status: 'active' })
        )

        expect(outcome.status).toBe('unapplied')
        const stored = await sub()
        expect(stored?.providerSubscriptionId).toBe('sub_original')
        expect(stored?.providerCustomerId).toBe('cus_original')
    })

    it('ignores the user id on an event whose provider ids already belong to someone else', async () => {
        await setSubscription(other.userId, { status: 'active', planCode: 'plus', ...ids(other) })
        await setSubscription(user.userId, { status: 'active', planCode: 'plus', providerCustomerId: null, providerSubscriptionId: null })

        await applyBillingEvent(
            event({ type: 'subscription.created', userId: user.userId, ...ids(other), planCode: 'pro', status: 'active' })
        )

        expect((await sub(other))?.planCode).toBe('pro')
        const untouched = await sub()
        expect(untouched?.planCode).toBe('plus')
        expect(untouched?.providerSubscriptionId ?? null).toBeNull()
    })

    it('does not create a row when the user does not exist or the id is malformed', async () => {
        for (const userId of ['000000000000000000000000', 'not-an-object-id']) {
            const outcome = await applyBillingEvent(
                event({ type: 'checkout.completed', userId, providerCustomerId: 'cus_x', providerSubscriptionId: 'sub_x', planCode: 'pro', status: 'active' })
            )
            expect(outcome.status).toBe('unapplied')
        }
        expect(await Subscription.countDocuments({})).toBe(0)
    })

    it('does not create a row without a plan and a status to grant', async () => {
        const outcome = await applyBillingEvent(event({ type: 'checkout.completed', userId: user.userId }))

        expect(outcome.status).toBe('unapplied')
        expect(await Subscription.countDocuments({})).toBe(0)
    })
})

describe('resubscribing after a subscription ended (M6)', () => {
    const NEW_IDS = { providerCustomerId: 'cus_original', providerSubscriptionId: 'sub_second' }

    it('moves the link onto the new provider subscription when the old one is cancelled', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.cancelled, providerCustomerId: 'cus_original', providerSubscriptionId: 'sub_original' })

        const outcome = await applyBillingEvent(
            event({ type: 'subscription.created', userId: user.userId, ...NEW_IDS, planCode: 'plus', status: 'active', currentPeriodEnd: daysFromNow(30) })
        )

        expect(outcome.status).toBe('applied')
        expect(await sub()).toMatchObject({ status: 'active', planCode: 'plus', providerSubscriptionId: 'sub_second', providerCustomerId: 'cus_original' })
    })

    it('does so even when the provider issues a new customer id for the new subscription', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.cancelled, providerCustomerId: 'cus_original', providerSubscriptionId: 'sub_original' })

        const outcome = await applyBillingEvent(
            event({ type: 'subscription.created', userId: user.userId, providerCustomerId: 'cus_second', providerSubscriptionId: 'sub_second', planCode: 'pro', status: 'active' })
        )

        expect(outcome.status).toBe('applied')
        expect(await sub()).toMatchObject({ status: 'active', planCode: 'pro', providerSubscriptionId: 'sub_second', providerCustomerId: 'cus_second' })
    })

    it('starts a clean billing slate: no stale dunning or lapse markers survive the new subscription', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.cancelled, providerCustomerId: 'cus_original', providerSubscriptionId: 'sub_original', lapsedAt: daysFromNow(-40) })

        await applyBillingEvent(event({ type: 'subscription.created', userId: user.userId, ...NEW_IDS, planCode: 'plus', status: 'active' }))

        expect(await sub()).toMatchObject({ pastDueSince: null, dunningStage: null })
    })

    it('a stale event for the OLD subscription can no longer revive or alter the row', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.cancelled, providerCustomerId: 'cus_original', providerSubscriptionId: 'sub_original', lastEventAt: daysFromNow(-3) })
        await applyBillingEvent(event({ type: 'subscription.created', userId: user.userId, ...NEW_IDS, planCode: 'plus', status: 'active', occurredAt: daysFromNow(-1) }))

        await applyBillingEvent(
            event({ type: 'subscription.deleted', providerCustomerId: 'cus_original', providerSubscriptionId: 'sub_original', status: 'cancelled', occurredAt: daysFromNow(-2) })
        )

        expect(await sub()).toMatchObject({ status: 'active', providerSubscriptionId: 'sub_second' })
    })

    it.each(['active', 'past_due', 'trialing'] as const)('never re-links a %s subscription, however the event names the user', async (status) => {
        await setSubscription(user.userId, { status, providerCustomerId: 'cus_original', providerSubscriptionId: 'sub_original' })

        const outcome = await applyBillingEvent(
            event({ type: 'subscription.created', userId: user.userId, providerCustomerId: 'cus_second', providerSubscriptionId: 'sub_second', planCode: 'pro', status: 'active' })
        )

        expect(outcome.status).toBe('unapplied')
        expect((await sub())?.providerSubscriptionId).toBe('sub_original')
    })

    it('an update event never moves the link, only a creation does', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.cancelled, providerCustomerId: 'cus_original', providerSubscriptionId: 'sub_original' })

        await applyBillingEvent(event({ type: 'subscription.updated', ...NEW_IDS, planCode: 'plus', status: 'active' }))

        expect((await sub())?.providerSubscriptionId).toBe('sub_original')
    })
})

describe('subscription events', () => {
    beforeEach(() => setSubscription(user.userId, { status: 'active', planCode: 'pro', ...ids() }))

    it('is unapplied for a subscription it does not know', async () => {
        const outcome = await applyBillingEvent(
            event({ providerCustomerId: 'cus_stranger', providerSubscriptionId: 'sub_stranger', status: 'active' })
        )

        expect(outcome.status).toBe('unapplied')
        expect(await Subscription.countDocuments({})).toBe(1)
    })

    it('rejects a plan outside the catalogue and a status outside the state machine', async () => {
        expect((await applyBillingEvent(event({ planCode: 'enterprise-unlimited', status: 'active' }))).status).toBe('unapplied')
        expect((await applyBillingEvent(event({ status: 'paused' as never }))).status).toBe('unapplied')
        expect((await sub())?.planCode).toBe('pro')
    })

    it('applies only the fields the event actually carries', async () => {
        const periodEnd = daysFromNow(45)

        await applyBillingEvent(event({ currentPeriodEnd: periodEnd }))

        const stored = await sub()
        expect(stored?.planCode).toBe('pro')
        expect(stored?.status).toBe('active')
        expect(stored?.currentPeriodEnd?.toISOString()).toBe(periodEnd.toISOString())
    })

    it('starts the dunning clock when an update reports past_due, and clears it on any other status', async () => {
        const occurredAt = new Date(Date.now() - 2 * DAY_MS)
        await applyBillingEvent(event({ status: 'past_due', occurredAt }))
        expect((await sub())?.pastDueSince?.toISOString()).toBe(occurredAt.toISOString())

        await applyBillingEvent(event({ status: 'active' }))
        expect((await sub())?.pastDueSince ?? null).toBeNull()
    })

    it('skips an event older than the last applied one but still reports it applied', async () => {
        const newer = new Date()
        await applyBillingEvent(event({ planCode: 'plus', occurredAt: newer }))

        const outcome = await applyBillingEvent(event({ planCode: 'pro', occurredAt: new Date(newer.getTime() - 1000) }))

        expect(outcome.status).toBe('applied')
        expect((await sub())?.planCode).toBe('plus')
        expect((await sub())?.lastEventAt?.toISOString()).toBe(newer.toISOString())
    })

    it('applies an event stamped at the same instant as the last one', async () => {
        const at = new Date()
        await applyBillingEvent(event({ planCode: 'plus', occurredAt: at }))

        await applyBillingEvent(event({ type: 'subscription.deleted', occurredAt: at }))

        expect((await sub())?.status).toBe('cancelled')
    })

    it('subscription.deleted cancels regardless of the status the event carries, and keeps the data-facing fields', async () => {
        await applyBillingEvent(event({ type: 'subscription.deleted', status: 'active' }))

        const stored = await sub()
        expect(stored?.status).toBe('cancelled')
        expect(stored?.planCode).toBe('pro')
    })
})

describe('payment events', () => {
    it('payment.failed only moves an active or already past_due subscription', async () => {
        for (const state of ['cancelled', 'trial_expired', 'trialing'] as const) {
            await setSubscription(user.userId, { ...BILLING_STATES[state], ...ids() })

            const outcome = await applyBillingEvent(event({ type: 'payment.failed' }))

            expect(outcome.status).toBe('applied')
            expect((await sub())?.status).toBe(BILLING_STATES[state].status)
        }
    })

    it('payment.succeeded does not resurrect a cancelled or expired subscription', async () => {
        for (const state of ['cancelled', 'trial_expired'] as const) {
            await setSubscription(user.userId, { ...BILLING_STATES[state], ...ids() })

            await applyBillingEvent(event({ type: 'payment.succeeded', currentPeriodEnd: daysFromNow(30) }))

            expect((await sub())?.status).toBe(BILLING_STATES[state].status)
        }
    })

    it('payment.succeeded on an active subscription extends the period without touching the plan', async () => {
        await setSubscription(user.userId, { status: 'active', planCode: 'pro', ...ids() })
        const periodEnd = daysFromNow(60)

        await applyBillingEvent(event({ type: 'payment.succeeded', currentPeriodEnd: periodEnd }))

        const stored = await sub()
        expect(stored?.planCode).toBe('pro')
        expect(stored?.currentPeriodEnd?.toISOString()).toBe(periodEnd.toISOString())
    })

    it('a payment event for an unknown subscription is unapplied', async () => {
        const outcome = await applyBillingEvent(event({ type: 'payment.failed', providerCustomerId: 'cus_stranger', providerSubscriptionId: 'sub_stranger' }))

        expect(outcome.status).toBe('unapplied')
    })
})

describe('record-only and unknown events', () => {
    it.each(['refund.issued', 'dispute.opened'] as const)('%s is applied without needing or changing a subscription', async (type) => {
        const outcome = await applyBillingEvent(event({ type, providerCustomerId: 'cus_stranger', providerSubscriptionId: 'sub_stranger' }))

        expect(outcome.status).toBe('applied')
        expect(await Subscription.countDocuments({})).toBe(0)
    })

    it('an event type outside the known set is applied as a no-op', async () => {
        expect((await applyBillingEvent(event({ type: 'customer.updated' }))).status).toBe('applied')
    })
})
