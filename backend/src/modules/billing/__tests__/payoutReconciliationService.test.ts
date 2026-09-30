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
        payload: { providerSubscriptionId, total: 1000, currency: 'USD', interval: 'monthly', planCode: 'pro', ...payload },
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
            planCode: 'pro',
            bucketIndex: 1,
            recognitionMonth: '2026-09',
            recognizedAmountMinor: 1000,
            currency: 'usd',
            paymentOccurredAt: new Date('2026-09-05T00:00:00.000Z'),
        })
        await DeferredRevenueEntry.create({
            sourceEventId: 'evt_bucket_1',
            planCode: 'pro',
            bucketIndex: 2,
            recognitionMonth: '2026-10',
            recognizedAmountMinor: 1000,
            currency: 'usd',
            paymentOccurredAt: new Date('2026-09-05T00:00:00.000Z'),
        })

        expect(await computeLocalRevenueByCurrency('2026-09')).toEqual({ USD: 1000 })
    })

    it('includes a monthly-plan payment occurring in the month, recognized immediately', async () => {
        await seedSubscription('sub_monthly', 'monthly')
        await seedPaymentEvent('sub_monthly', new Date('2026-09-15T12:00:00.000Z'), { total: 500 })

        expect(await computeLocalRevenueByCurrency('2026-09')).toEqual({ USD: 500 })
    })

    it('excludes an annual-plan payment - it is recognized through DeferredRevenueEntry, not counted twice here', async () => {
        await seedSubscription('sub_annual', 'annual')
        await seedPaymentEvent('sub_annual', new Date('2026-09-15T12:00:00.000Z'), { total: 12000, interval: 'annual' })

        expect(await computeLocalRevenueByCurrency('2026-09')).toEqual({})
    })

    it('excludes a refunded payment', async () => {
        await seedSubscription('sub_monthly_refunded', 'monthly')
        await seedPaymentEvent('sub_monthly_refunded', new Date('2026-09-15T12:00:00.000Z'), { refunded: true })

        expect(await computeLocalRevenueByCurrency('2026-09')).toEqual({})
    })

    it('includes a monthly payment whose subscription row no longer exists', async () => {
        await seedPaymentEvent('sub_unknown', new Date('2026-09-15T12:00:00.000Z'))

        expect(await computeLocalRevenueByCurrency('2026-09')).toEqual({ USD: 1000 })
    })

    it('excludes a payment whose price could not be classified, and does not fall back to the subscription row', async () => {
        await seedSubscription('sub_unclassified', 'monthly')
        await seedPaymentEvent('sub_unclassified', new Date('2026-09-15T12:00:00.000Z'), { interval: undefined, planCode: undefined })

        expect(await computeLocalRevenueByCurrency('2026-09')).toEqual({})
    })

    describe('classifies from the payment itself, not from the subscription as it is now (BUG-45)', () => {
        it('counts a monthly payment after the subscriber moved to annual', async () => {
            await seedSubscription('sub_moved_up', 'annual')
            await seedPaymentEvent('sub_moved_up', new Date('2026-09-15T12:00:00.000Z'), { total: 500, interval: 'monthly' })

            expect(await computeLocalRevenueByCurrency('2026-09')).toEqual({ USD: 500 })
        })

        it('leaves an annual payment to its recognition buckets after the subscriber moved to monthly', async () => {
            await seedSubscription('sub_moved_down', 'monthly')
            await seedPaymentEvent('sub_moved_down', new Date('2026-09-15T12:00:00.000Z'), { total: 12000, interval: 'annual' })

            expect(await computeLocalRevenueByCurrency('2026-09')).toEqual({})
        })

        it('keeps a monthly payment in the month after its payer erased their account and the ledger lost the provider ids', async () => {
            const event = await seedPaymentEvent('sub_erased', new Date('2026-09-15T12:00:00.000Z'), { total: 500 })
            await BillingEvent.collection.updateOne(
                { providerEventId: event.providerEventId },
                { $unset: { 'payload.providerSubscriptionId': '', 'payload.providerCustomerId': '' }, $set: { redactedAt: new Date() } }
            )

            expect(await computeLocalRevenueByCurrency('2026-09')).toEqual({ USD: 500 })
        })
    })

    it('reports currencies uppercase and merges lowercase rows written before currencies were normalised (BUG-46)', async () => {
        await seedSubscription('sub_upper', 'monthly')
        await seedPaymentEvent('sub_upper', new Date('2026-09-15T12:00:00.000Z'), { total: 500, currency: 'USD' })
        await seedPaymentEvent('sub_upper', new Date('2026-09-16T12:00:00.000Z'), { total: 300, currency: 'usd' })
        await DeferredRevenueEntry.create({
            sourceEventId: 'evt_bucket_lower',
            planCode: 'pro',
            bucketIndex: 1,
            recognitionMonth: '2026-09',
            recognizedAmountMinor: 200,
            currency: 'usd',
            paymentOccurredAt: new Date('2026-09-05T00:00:00.000Z'),
        })

        expect(await computeLocalRevenueByCurrency('2026-09')).toEqual({ USD: 1000 })
    })

    it('excludes a payment outside the month, at either boundary', async () => {
        await seedSubscription('sub_boundary', 'monthly')
        await seedPaymentEvent('sub_boundary', new Date('2026-08-31T23:59:59.999Z'), { total: 100 })
        await seedPaymentEvent('sub_boundary', new Date('2026-10-01T00:00:00.000Z'), { total: 200 })

        expect(await computeLocalRevenueByCurrency('2026-09')).toEqual({})
    })

    it('groups by currency across mixed monthly payments and recognition buckets', async () => {
        await seedSubscription('sub_monthly_usd', 'monthly')
        await seedPaymentEvent('sub_monthly_usd', new Date('2026-09-15T12:00:00.000Z'), { total: 500, currency: 'USD' })
        await seedSubscription('sub_monthly_eur', 'monthly')
        await seedPaymentEvent('sub_monthly_eur', new Date('2026-09-16T12:00:00.000Z'), { total: 400, currency: 'EUR' })
        await DeferredRevenueEntry.create({
            sourceEventId: 'evt_bucket_eur',
            planCode: 'pro',
            bucketIndex: 1,
            recognitionMonth: '2026-09',
            recognizedAmountMinor: 300,
            currency: 'eur',
            paymentOccurredAt: new Date('2026-09-05T00:00:00.000Z'),
        })

        expect(await computeLocalRevenueByCurrency('2026-09')).toEqual({ USD: 500, EUR: 700 })
    })
})
