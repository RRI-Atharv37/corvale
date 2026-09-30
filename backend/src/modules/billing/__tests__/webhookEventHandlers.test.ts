import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import app from '@http/app'
import { setMailTransport, type MailMessage } from '@infra/mail/mailService'
import {
    BillingEvent,
    MetricDaily,
    Subscription,
    applyBillingEvent,
    clearPlanPricesCache,
    seedPlanCatalogue,
    createFakeBillingProvider,
    resetBillingProvider,
    setBillingProvider,
    type FakeProviderCalls,
    type NormalizedBillingEvent,
} from '@modules/billing'
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
            event({ type: 'checkout.completed', userId: user.userId, planCode: 'pro', status: 'active' })
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
        await setSubscription(other.userId, { status: 'active', interval: 'monthly', ...ids(other) })
        await setSubscription(user.userId, { status: 'active', interval: 'monthly', providerCustomerId: null, providerSubscriptionId: null })

        await applyBillingEvent(
            event({ type: 'subscription.created', userId: user.userId, ...ids(other), interval: 'annual', status: 'active' })
        )

        expect((await sub(other))?.interval).toBe('annual')
        const untouched = await sub()
        expect(untouched?.interval).toBe('monthly')
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
            event({ type: 'subscription.created', userId: user.userId, ...NEW_IDS, planCode: 'pro', status: 'active', currentPeriodEnd: daysFromNow(30) })
        )

        expect(outcome.status).toBe('applied')
        expect(await sub()).toMatchObject({ status: 'active', planCode: 'pro', providerSubscriptionId: 'sub_second', providerCustomerId: 'cus_original' })
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

        await applyBillingEvent(event({ type: 'subscription.created', userId: user.userId, ...NEW_IDS, planCode: 'pro', status: 'active' }))

        expect(await sub()).toMatchObject({ pastDueSince: null, dunningStage: null })
    })

    it('a stale event for the OLD subscription can no longer revive or alter the row', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.cancelled, providerCustomerId: 'cus_original', providerSubscriptionId: 'sub_original', lastEventAt: daysFromNow(-3) })
        await applyBillingEvent(event({ type: 'subscription.created', userId: user.userId, ...NEW_IDS, planCode: 'pro', status: 'active', occurredAt: daysFromNow(-1) }))

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

        await applyBillingEvent(event({ type: 'subscription.updated', ...NEW_IDS, planCode: 'pro', status: 'active' }))

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
        await applyBillingEvent(event({ interval: 'annual', occurredAt: newer }))

        const outcome = await applyBillingEvent(event({ interval: 'monthly', occurredAt: new Date(newer.getTime() - 1000) }))

        expect(outcome.status).toBe('applied')
        expect((await sub())?.interval).toBe('annual')
        expect((await sub())?.lastEventAt?.toISOString()).toBe(newer.toISOString())
    })

    it('applies an event stamped at the same instant as the last one', async () => {
        const at = new Date()
        await applyBillingEvent(event({ planCode: 'pro', occurredAt: at }))

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

describe('dispute revokes access, refund does not (Refund Policy, 2026-09-28)', () => {
    it('cancels a matching subscription the moment a dispute opens', async () => {
        await setSubscription(user.userId, BILLING_STATES.active)

        const outcome = await applyBillingEvent(event({ type: 'dispute.opened' }))

        expect(outcome.status).toBe('applied')
        const stored = await sub()
        expect(stored?.status).toBe('cancelled')
        expect(stored?.pastDueSince).toBeNull()
    })

    it('clears an in-progress dunning stage when a dispute cancels the subscription', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.past_due_in_grace, dunningStage: 'reminder' })

        await applyBillingEvent(event({ type: 'dispute.opened' }))

        const stored = await sub()
        expect(stored?.status).toBe('cancelled')
        expect(stored?.dunningStage).toBeNull()
    })

    it('a dispute with no matching subscription stays record-only, same as before', async () => {
        const outcome = await applyBillingEvent(
            event({ type: 'dispute.opened', providerCustomerId: 'cus_stranger', providerSubscriptionId: 'sub_stranger' })
        )

        expect(outcome.status).toBe('applied')
        expect(await Subscription.countDocuments({})).toBe(0)
    })

    it('a refund never changes subscription status, only the ledger and metrics', async () => {
        await setSubscription(user.userId, BILLING_STATES.active)

        await applyBillingEvent(event({ type: 'refund.issued' }))

        const stored = await sub()
        expect(stored?.status).toBe('active')
    })
})

describe('a dispute is sticky and reaches the provider (BUG-43)', () => {
    let calls: FakeProviderCalls

    beforeEach(() => {
        const fake = createFakeBillingProvider()
        calls = fake.calls
        setBillingProvider(fake.provider)
    })

    afterEach(() => resetBillingProvider())

    const activeAndDisputed = async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.active, lastEventAt: daysFromNow(-2) })
        await applyBillingEvent(event({ type: 'dispute.opened', occurredAt: daysFromNow(-1) }))
    }

    it('marks the row disputed and cancels the provider subscription immediately', async () => {
        await setSubscription(user.userId, BILLING_STATES.active)

        await applyBillingEvent(event({ type: 'dispute.opened' }))

        const stored = await sub()
        expect(stored?.status).toBe('cancelled')
        expect(stored?.disputedAt).toBeInstanceOf(Date)
        expect(calls.cancelSubscription).toEqual([{ providerSubscriptionId: `sub_${user.userId}`, immediate: true }])
    })

    it('a later subscription.updated saying active does not restore access', async () => {
        await activeAndDisputed()

        const outcome = await applyBillingEvent(event({ type: 'subscription.updated', status: 'active', occurredAt: new Date(), currentPeriodEnd: daysFromNow(30) }))

        expect(outcome.status).toBe('applied')
        const stored = await sub()
        expect(stored?.status).toBe('cancelled')
        expect(stored?.currentPeriodEnd?.getTime()).toBeGreaterThan(daysFromNow(29).getTime())
    })

    it.each(['past_due', 'trialing'] as const)('a later subscription.updated saying %s does not move the status either', async (status) => {
        await activeAndDisputed()

        await applyBillingEvent(event({ type: 'subscription.updated', status, occurredAt: new Date() }))

        const stored = await sub()
        expect(stored?.status).toBe('cancelled')
        expect(stored?.pastDueSince).toBeNull()
    })

    it('a later payment.succeeded does not restore access', async () => {
        await activeAndDisputed()

        await applyBillingEvent(event({ type: 'payment.succeeded', occurredAt: new Date() }))

        expect((await sub())?.status).toBe('cancelled')
    })

    it('a new subscription.created for the disputed user is left unapplied and moves no provider id', async () => {
        await activeAndDisputed()

        const outcome = await applyBillingEvent(
            event({
                type: 'subscription.created',
                userId: user.userId,
                providerCustomerId: 'cus_new',
                providerSubscriptionId: 'sub_new',
                planCode: 'pro',
                status: 'active',
                occurredAt: new Date(),
            })
        )

        expect(outcome.status).toBe('unapplied')
        const stored = await sub()
        expect(stored?.status).toBe('cancelled')
        expect(stored?.providerSubscriptionId).toBe(`sub_${user.userId}`)
    })

    it('a dispute older than the last applied event still revokes access', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.active, lastEventAt: new Date() })

        await applyBillingEvent(event({ type: 'dispute.opened', occurredAt: daysFromNow(-1) }))

        const stored = await sub()
        expect(stored?.status).toBe('cancelled')
        expect(stored?.disputedAt).toBeInstanceOf(Date)
    })

    it('a dispute on an already-cancelled subscription still becomes sticky, without another provider call', async () => {
        await setSubscription(user.userId, BILLING_STATES.cancelled)

        await applyBillingEvent(event({ type: 'dispute.opened' }))

        expect((await sub())?.disputedAt).toBeInstanceOf(Date)
        expect(calls.cancelSubscription).toHaveLength(0)
    })

    it('a redelivered dispute keeps the first disputedAt', async () => {
        await setSubscription(user.userId, BILLING_STATES.active)
        const first = daysFromNow(-3)

        await applyBillingEvent(event({ type: 'dispute.opened', occurredAt: first }))
        await applyBillingEvent(event({ type: 'dispute.opened', occurredAt: new Date() }))

        expect((await sub())?.disputedAt?.getTime()).toBe(first.getTime())
    })

    it('a provider-side cancellation of a disputed subscription is still applied', async () => {
        await activeAndDisputed()

        const outcome = await applyBillingEvent(event({ type: 'subscription.deleted', status: 'cancelled', occurredAt: new Date() }))

        expect(outcome.status).toBe('applied')
        expect((await sub())?.status).toBe('cancelled')
    })

    it('still revokes locally and applies the event when the provider cancel fails', async () => {
        const failing = createFakeBillingProvider()
        failing.provider.cancelSubscription = async () => {
            throw new Error('provider down')
        }
        setBillingProvider(failing.provider)
        await setSubscription(user.userId, BILLING_STATES.active)

        const outcome = await applyBillingEvent(event({ type: 'dispute.opened' }))

        expect(outcome.status).toBe('applied')
        const stored = await sub()
        expect(stored?.status).toBe('cancelled')
        expect(stored?.disputedAt).toBeInstanceOf(Date)
    })

    it('a subscription that is not disputed still follows routine provider events', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.past_due_in_grace })

        await applyBillingEvent(event({ type: 'subscription.updated', status: 'active', occurredAt: new Date() }))

        expect((await sub())?.status).toBe('active')
    })
})

describe('a forged checkout link cannot attach a subscription to another account (SEC-72)', () => {
    it('a creation event with no verified user id and unknown provider ids links nothing', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.trialing, providerCustomerId: null, providerSubscriptionId: null })

        const outcome = await applyBillingEvent(
            event({
                type: 'subscription.created',
                userId: undefined,
                providerCustomerId: 'cus_attacker',
                providerSubscriptionId: 'sub_attacker',
                planCode: 'pro',
                status: 'active',
            })
        )

        expect(outcome.status).toBe('unapplied')
        const stored = await sub()
        expect(stored?.status).toBe('trialing')
        expect(stored?.providerSubscriptionId).toBeNull()
    })
})

describe('dispute alert email', () => {
    let sent: MailMessage[]
    let sendMail: Mock<(message: MailMessage) => Promise<{ messageId: string }>>

    beforeEach(() => {
        sent = []
        sendMail = vi.fn(async (message: MailMessage) => {
            sent.push(message)
            return { messageId: `m-${sent.length}` }
        })
        setMailTransport({ sendMail })
    })

    afterEach(() => {
        delete process.env.SMTP_HOST
        delete process.env.BILLING_ALERT_EMAIL
        setMailTransport(null)
    })

    it('alerts the configured address when a dispute opens', async () => {
        process.env.SMTP_HOST = 'smtp.test.local'
        process.env.BILLING_ALERT_EMAIL = 'billing@corvale.example'

        const outcome = await applyBillingEvent(event({ type: 'dispute.opened' }))

        expect(outcome.status).toBe('applied')
        expect(sent).toHaveLength(1)
        expect(sent[0]?.to).toBe('billing@corvale.example')
        expect(sent[0]?.subject).toMatch(/dispute/i)
    })

    it('does not alert on a plain refund, only a dispute', async () => {
        process.env.SMTP_HOST = 'smtp.test.local'
        process.env.BILLING_ALERT_EMAIL = 'billing@corvale.example'

        await applyBillingEvent(event({ type: 'refund.issued' }))

        expect(sent).toHaveLength(0)
    })

    it('sends nothing when no alert address is configured', async () => {
        process.env.SMTP_HOST = 'smtp.test.local'
        delete process.env.BILLING_ALERT_EMAIL

        await applyBillingEvent(event({ type: 'dispute.opened' }))

        expect(sent).toHaveLength(0)
    })

    it('sends nothing when SMTP is not configured', async () => {
        delete process.env.SMTP_HOST
        process.env.BILLING_ALERT_EMAIL = 'billing@corvale.example'

        await applyBillingEvent(event({ type: 'dispute.opened' }))

        expect(sent).toHaveLength(0)
    })

    it('still applies the event when the mail transport fails', async () => {
        process.env.SMTP_HOST = 'smtp.test.local'
        process.env.BILLING_ALERT_EMAIL = 'billing@corvale.example'
        sendMail.mockRejectedValueOnce(new Error('smtp down'))

        const outcome = await applyBillingEvent(event({ type: 'dispute.opened' }))

        expect(outcome.status).toBe('applied')
    })
})

describe('a dispute is counted together with its churn (BUG-49)', () => {
    beforeEach(async () => {
        const fake = createFakeBillingProvider()
        setBillingProvider(fake.provider)
        await seedPlanCatalogue()
        clearPlanPricesCache()
    })

    afterEach(() => resetBillingProvider())

    const flows = async () => (await MetricDaily.find({}).lean())[0]?.flows

    const ledgered = async (overrides: Partial<NormalizedBillingEvent>) => {
        const disputeEvent = event({ type: 'dispute.opened', ...overrides })
        await BillingEvent.create({ providerEventId: disputeEvent.providerEventId, type: 'dispute.opened', occurredAt: disputeEvent.occurredAt, payload: {} })
        return disputeEvent
    }

    it('counts the dispute and the involuntary churn of the subscriber it cancels', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.active, planCode: 'pro', interval: 'monthly', cancelAtPeriodEnd: false })

        await applyBillingEvent(await ledgered({}))

        expect(await flows()).toMatchObject({ disputes: 1, churnedInvoluntary: 1, churnedMrr: 1200 })
    })

    it('counts only the dispute when nothing live was cancelled', async () => {
        await setSubscription(user.userId, BILLING_STATES.cancelled)

        await applyBillingEvent(await ledgered({}))

        expect(await flows()).toMatchObject({ disputes: 1, churnedInvoluntary: 0, churnedMrr: 0 })
    })

    it('counts a dispute with no matching subscription', async () => {
        await applyBillingEvent(await ledgered({ providerCustomerId: 'cus_stranger', providerSubscriptionId: 'sub_stranger' }))

        expect(await flows()).toMatchObject({ disputes: 1 })
    })

    it('a redelivered dispute is not counted twice', async () => {
        await setSubscription(user.userId, { ...BILLING_STATES.active, planCode: 'pro', interval: 'monthly', cancelAtPeriodEnd: false })
        const disputeEvent = await ledgered({})

        await applyBillingEvent(disputeEvent)
        await applyBillingEvent(disputeEvent)

        expect(await flows()).toMatchObject({ disputes: 1, churnedInvoluntary: 1 })
    })
})
