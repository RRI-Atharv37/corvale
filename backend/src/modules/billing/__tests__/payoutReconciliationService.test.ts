import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'

import BillingEvent from '../billingEvent.model'
import DeferredRevenueEntry from '../deferredRevenueEntry.model'
import Subscription from '../subscription.model'
import { computeLocalRevenueByCurrency, isValidPeriodMonth } from '../payoutReconciliation.service'

/**
 * M8f - local-revenue computation for one calendar month, the figure a `ProviderPayout` is
 * reconciled against. Seeds `DeferredRevenueEntry`/`BillingEvent`/`Subscription` directly, same as
 * the M8e sweep tests, rather than running the sweep or posting a webhook.
 */

let eventCounter = 0
const nextEventId = (): string => {
    eventCounter += 1
    return `evt_payout_${eventCounter}`
}

const seedSubscription = (providerSubscriptionId: string, interval: 'monthly' | 'annual') =>
    Subscription.create({
        userId: new Types.ObjectId(),
        planCode: 'pro',
        status: 'active',
        interval,
        providerSubscriptionId,
        providerCustomerId: `cus_${providerSubscriptionId}`,
    })

const seedPaymentEvent = (providerSubscriptionId: string, occurredAt: Date, payload: Record<string, unknown> = {}) =>
    BillingEvent.create({
        providerEventId: nextEventId(),
        type: 'payment.succeeded',
        occurredAt,
        payload: { providerSubscriptionId, total: 1000, currency: 'usd', ...payload },
    })

describe('isValidPeriodMonth', () => {
    it('accepts a well-formed YYYY-MM and rejects everything else', () => {
        expect(isValidPeriodMonth('2026-09')).toBe(true)
        expect(isValidPeriodMonth('2026-13')).toBe(false)
        expect(isValidPeriodMonth('2026-9')).toBe(false)
        expect(isValidPeriodMonth('not-a-month')).toBe(false)
    })
})

describe('computeLocalRevenueByCurrency', () => {
    it('returns an empty object for a month with no recorded revenue', async () => {
        expect(await computeLocalRevenueByCurrency('2026-09')).toEqual({})
    })

    it('sums DeferredRevenueEntry buckets for the month, by currency', async () => {
        await DeferredRevenueEntry.create({
            sourceEventId: 'evt_bucket_1',
            providerSubscriptionId: 'sub_annual',
            planCode: 'pro',
            bucketIndex: 1,
            recognitionMonth: '2026-09',
            recognizedAmountMinor: 1000,
            currency: 'usd',
            paymentOccurredAt: new Date('2026-09-05T00:00:00.000Z'),
        })
        await DeferredRevenueEntry.create({
            sourceEventId: 'evt_bucket_1',
            providerSubscriptionId: 'sub_annual',
            planCode: 'pro',
            bucketIndex: 2,
            recognitionMonth: '2026-10',
            recognizedAmountMinor: 1000,
            currency: 'usd',
            paymentOccurredAt: new Date('2026-09-05T00:00:00.000Z'),
        })

        expect(await computeLocalRevenueByCurrency('2026-09')).toEqual({ usd: 1000 })
    })

    it('includes a monthly-plan payment occurring in the month, recognized immediately', async () => {
        await seedSubscription('sub_monthly', 'monthly')
        await seedPaymentEvent('sub_monthly', new Date('2026-09-15T12:00:00.000Z'), { total: 500 })

        expect(await computeLocalRevenueByCurrency('2026-09')).toEqual({ usd: 500 })
    })

    it('excludes an annual-plan payment - it is recognized through DeferredRevenueEntry, not counted twice here', async () => {
        await seedSubscription('sub_annual', 'annual')
        await seedPaymentEvent('sub_annual', new Date('2026-09-15T12:00:00.000Z'), { total: 12000 })

        expect(await computeLocalRevenueByCurrency('2026-09')).toEqual({})
    })

    it('excludes a refunded payment', async () => {
        await seedSubscription('sub_monthly_refunded', 'monthly')
        await seedPaymentEvent('sub_monthly_refunded', new Date('2026-09-15T12:00:00.000Z'), { refunded: true })

        expect(await computeLocalRevenueByCurrency('2026-09')).toEqual({})
    })

    it('excludes a payment with no matching subscription', async () => {
        await seedPaymentEvent('sub_unknown', new Date('2026-09-15T12:00:00.000Z'))

        expect(await computeLocalRevenueByCurrency('2026-09')).toEqual({})
    })

    it('excludes a payment outside the month, at either boundary', async () => {
        await seedSubscription('sub_boundary', 'monthly')
        await seedPaymentEvent('sub_boundary', new Date('2026-08-31T23:59:59.999Z'), { total: 100 })
        await seedPaymentEvent('sub_boundary', new Date('2026-10-01T00:00:00.000Z'), { total: 200 })

        expect(await computeLocalRevenueByCurrency('2026-09')).toEqual({})
    })

    it('groups by currency across mixed monthly payments and recognition buckets', async () => {
        await seedSubscription('sub_monthly_usd', 'monthly')
        await seedPaymentEvent('sub_monthly_usd', new Date('2026-09-15T12:00:00.000Z'), { total: 500, currency: 'usd' })
        await seedSubscription('sub_monthly_eur', 'monthly')
        await seedPaymentEvent('sub_monthly_eur', new Date('2026-09-16T12:00:00.000Z'), { total: 400, currency: 'eur' })
        await DeferredRevenueEntry.create({
            sourceEventId: 'evt_bucket_eur',
            providerSubscriptionId: 'sub_annual_eur',
            planCode: 'pro',
            bucketIndex: 1,
            recognitionMonth: '2026-09',
            recognizedAmountMinor: 300,
            currency: 'eur',
            paymentOccurredAt: new Date('2026-09-05T00:00:00.000Z'),
        })

        expect(await computeLocalRevenueByCurrency('2026-09')).toEqual({ usd: 500, eur: 700 })
    })
})
