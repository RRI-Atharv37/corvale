import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ZERO_FLOWS } from '@core/billing/metrics'
import {
    BillingEvent,
    MetricDaily,
    Subscription,
    claimMetricsOnce,
    clearPlanPricesCache,
    computeStockSegments,
    recordMetric,
    recordSubscriptionTransitionMetrics,
    recordTransitionMetrics,
    seedPlanCatalogue,
    type ISubscription,
} from '@modules/billing'
import { disableBilling, enableBilling, setSubscription } from '@tests/billingHelpers'

/**
 * M7b.1 - the DB-touching half of the metrics instrumentation: same-day `$inc`, the at-most-once claim
 * on a `BillingEvent`, and the transition-to-flow-counter derivation `webhookEventHandlers.ts` calls on
 * every subscription write.
 */

const flowsOf = async (date: string) => (await MetricDaily.findOne({ date }).lean())?.flows

const subscription = (over: Partial<ISubscription> = {}): ISubscription =>
    ({
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(),
        planCode: 'pro',
        status: 'active',
        interval: 'monthly',
        cancelAtPeriodEnd: false,
        grandfatherKind: null,
        adminGrant: null,
        ...over,
    }) as ISubscription

beforeEach(async () => {
    enableBilling()
    await seedPlanCatalogue()
    clearPlanPricesCache()
})

afterEach(() => {
    disableBilling()
})

describe('recordMetric', () => {
    it('upserts the UTC day and increments only the named field', async () => {
        await recordMetric('signups', 1, new Date('2026-09-22T10:00:00.000Z'))

        const flows = await flowsOf('2026-09-22')
        expect(flows?.signups).toBe(1)
        expect(flows?.trialStarted).toBe(0)
    })

    it('accumulates across calls on the same day', async () => {
        await recordMetric('signups', 1, new Date('2026-09-22T01:00:00.000Z'))
        await recordMetric('signups', 1, new Date('2026-09-22T23:00:00.000Z'))

        expect((await flowsOf('2026-09-22'))?.signups).toBe(2)
    })

    it('is a no-op for a zero amount - no document is created', async () => {
        await recordMetric('signups', 0, new Date('2026-09-22T10:00:00.000Z'))

        expect(await MetricDaily.countDocuments({})).toBe(0)
    })

    it('flags a late increment on an already-closed day with flowRevisedAt', async () => {
        await MetricDaily.create({ date: '2026-09-20', closed: true, flows: ZERO_FLOWS })

        await recordMetric('refunds', 1, new Date('2026-09-20T23:59:00.000Z'))

        const row = await MetricDaily.findOne({ date: '2026-09-20' }).lean()
        expect(row?.flows.refunds).toBe(1)
        expect(row?.flowRevisedAt).toBeTruthy()
    })
})

describe('claimMetricsOnce', () => {
    it('the first claim succeeds; a second claim of the same event does not', async () => {
        await BillingEvent.create({ providerEventId: 'evt_claim_1', type: 'subscription.updated', occurredAt: new Date(), payload: {} })

        expect(await claimMetricsOnce('evt_claim_1')).toBe(true)
        expect(await claimMetricsOnce('evt_claim_1')).toBe(false)
    })

    it('an unknown event id cannot be claimed', async () => {
        expect(await claimMetricsOnce('evt_does_not_exist')).toBe(false)
    })
})

describe('recordTransitionMetrics', () => {
    it('records only the non-zero fields given, guarded by the event claim', async () => {
        await BillingEvent.create({ providerEventId: 'evt_transition_1', type: 'subscription.updated', occurredAt: new Date(), payload: {} })
        const at = new Date('2026-09-22T10:00:00.000Z')

        await recordTransitionMetrics('evt_transition_1', at, { newPaid: 1, expansionMrr: 0, churnedVoluntary: undefined })
        await recordTransitionMetrics('evt_transition_1', at, { newPaid: 1 })

        const flows = await flowsOf('2026-09-22')
        expect(flows?.newPaid).toBe(1)
        expect(flows?.expansionMrr).toBe(0)
    })

    it('is a no-op when every given amount is zero or absent', async () => {
        await BillingEvent.create({ providerEventId: 'evt_transition_2', type: 'subscription.updated', occurredAt: new Date(), payload: {} })

        await recordTransitionMetrics('evt_transition_2', new Date(), { newPaid: 0 })

        expect(await MetricDaily.countDocuments({})).toBe(0)
    })
})

describe('recordSubscriptionTransitionMetrics', () => {
    const at = new Date('2026-09-22T12:00:00.000Z')
    let eventCounter = 0
    const seedEvent = async () => {
        eventCounter += 1
        const providerEventId = `evt_sub_metrics_${eventCounter}`
        await BillingEvent.create({ providerEventId, type: 'subscription.updated', occurredAt: at, payload: {} })
        return providerEventId
    }

    it('a fresh checkout straight into active counts as new paid MRR, not a trial conversion', async () => {
        const providerEventId = await seedEvent()

        await recordSubscriptionTransitionMetrics(null, { status: 'active', planCode: 'pro', interval: 'monthly' }, providerEventId, at)

        const flows = await flowsOf('2026-09-22')
        expect(flows?.newPaid).toBe(1)
        expect(flows?.newMrr).toBe(1200)
        expect(flows?.trialConverted).toBe(0)
    })

    it('trialing to active counts as both a conversion and new paid MRR', async () => {
        const providerEventId = await seedEvent()
        const before = subscription({ status: 'trialing', planCode: 'pro', interval: null })

        await recordSubscriptionTransitionMetrics(before, { status: 'active', interval: 'monthly' }, providerEventId, at)

        const flows = await flowsOf('2026-09-22')
        expect(flows?.trialConverted).toBe(1)
        expect(flows?.newPaid).toBe(1)
    })

    it('an upgrade while active is expansion MRR, a downgrade is contraction', async () => {
        const upEvent = await seedEvent()
        await recordSubscriptionTransitionMetrics(subscription({ planCode: 'plus', interval: 'monthly' }), { planCode: 'pro' }, upEvent, at)
        expect((await flowsOf('2026-09-22'))?.expansionMrr).toBe(600)

        const downEvent = await seedEvent()
        await recordSubscriptionTransitionMetrics(subscription({ planCode: 'pro', interval: 'monthly' }), { planCode: 'plus' }, downEvent, at)
        expect((await flowsOf('2026-09-22'))?.contractionMrr).toBe(600)
    })

    it('cancelling a subscription set to end at period end is voluntary churn', async () => {
        const providerEventId = await seedEvent()
        const before = subscription({ status: 'active', planCode: 'pro', interval: 'monthly', cancelAtPeriodEnd: true })

        await recordSubscriptionTransitionMetrics(before, { status: 'cancelled' }, providerEventId, at)

        const flows = await flowsOf('2026-09-22')
        expect(flows?.churnedVoluntary).toBe(1)
        expect(flows?.churnedInvoluntary).toBe(0)
        expect(flows?.churnedMrr).toBe(1200)
    })

    it('cancelling a subscription that was not set to end is involuntary churn', async () => {
        const providerEventId = await seedEvent()
        const before = subscription({ status: 'past_due', planCode: 'pro', interval: 'monthly', cancelAtPeriodEnd: false })

        await recordSubscriptionTransitionMetrics(before, { status: 'cancelled' }, providerEventId, at)

        const flows = await flowsOf('2026-09-22')
        expect(flows?.churnedInvoluntary).toBe(1)
        expect(flows?.churnedVoluntary).toBe(0)
    })

    it('entering past_due and recovering back to active are each counted once', async () => {
        const enterEvent = await seedEvent()
        await recordSubscriptionTransitionMetrics(subscription({ status: 'active' }), { status: 'past_due' }, enterEvent, at)
        expect((await flowsOf('2026-09-22'))?.pastDueEntered).toBe(1)

        const recoverEvent = await seedEvent()
        await recordSubscriptionTransitionMetrics(subscription({ status: 'past_due' }), { status: 'active' }, recoverEvent, at)
        expect((await flowsOf('2026-09-22'))?.dunningRecovered).toBe(1)
    })

    it('a redelivery of the same event does not double the counters', async () => {
        const providerEventId = await seedEvent()

        await recordSubscriptionTransitionMetrics(null, { status: 'active', planCode: 'pro', interval: 'monthly' }, providerEventId, at)
        await recordSubscriptionTransitionMetrics(null, { status: 'active', planCode: 'pro', interval: 'monthly' }, providerEventId, at)

        expect((await flowsOf('2026-09-22'))?.newPaid).toBe(1)
    })
})

describe('computeStockSegments', () => {
    it('groups rows by plan, status, interval and grandfather kind', async () => {
        const a = new Types.ObjectId().toString()
        const b = new Types.ObjectId().toString()
        await setSubscription(a, { status: 'active', planCode: 'pro' })
        await setSubscription(b, { status: 'active', planCode: 'pro' })

        const segments = await computeStockSegments(new Date())

        const match = segments.find((segment) => segment.planCode === 'pro' && segment.status === 'active')
        expect(match?.count).toBeGreaterThanOrEqual(2)
    })

    it('excludes a row with an active admin grant, but includes one whose grant has expired', async () => {
        const active = new Types.ObjectId().toString()
        const expired = new Types.ObjectId().toString()
        const grant = { kind: 'comp' as const, planCode: 'pro' as const, limits: null, grantedBy: new Types.ObjectId(), grantedAt: new Date() }
        await setSubscription(active, { status: 'active', planCode: 'pro' })
        await setSubscription(expired, { status: 'active', planCode: 'pro' })
        await Subscription.updateOne({ userId: active }, { $set: { adminGrant: { ...grant, until: new Date(Date.now() + 100000) } } })
        await Subscription.updateOne({ userId: expired }, { $set: { adminGrant: { ...grant, until: new Date(Date.now() - 100000) } } })

        const segments = await computeStockSegments(new Date())
        const total = segments.filter((segment) => segment.planCode === 'pro' && segment.status === 'active').reduce((sum, segment) => sum + segment.count, 0)

        expect(total).toBe(1)
    })
})
