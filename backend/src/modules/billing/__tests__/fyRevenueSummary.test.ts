import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'

import BillingEvent from '../billingEvent.model'
import DeferredRevenueEntry from '../deferredRevenueEntry.model'
import Subscription from '../subscription.model'
import { computeFinancialYearRevenue } from '../fyRevenueSummary.service'

/**
 * M8g - the financial-year running-revenue-total, built on the same read-time
 * `computeLocalRevenueByCurrency` M8f uses. Seeds `DeferredRevenueEntry`/`BillingEvent`/
 * `Subscription` directly, same as the M8e/M8f tests.
 */

let eventCounter = 0
const nextEventId = (): string => {
    eventCounter += 1
    return `evt_fy_${eventCounter}`
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

describe('computeFinancialYearRevenue', () => {
    it('only includes months of the financial year that have elapsed by asOf', async () => {
        const summary = await computeFinancialYearRevenue('2026-27', new Date('2026-06-15T00:00:00.000Z'))

        expect(summary.financialYear).toBe('2026-27')
        expect(summary.monthsIncluded).toEqual(['2026-04', '2026-05', '2026-06'])
        expect(summary.byMonth).toHaveLength(3)
        expect(summary.totalsByCurrency).toEqual({})
    })

    it('sums DeferredRevenueEntry buckets across months, by currency', async () => {
        await DeferredRevenueEntry.create({
            sourceEventId: 'evt_bucket_1',
            providerSubscriptionId: 'sub_annual',
            planCode: 'pro',
            bucketIndex: 1,
            recognitionMonth: '2026-04',
            recognizedAmountMinor: 1000,
            currency: 'usd',
            paymentOccurredAt: new Date('2026-04-10T00:00:00.000Z'),
        })
        await DeferredRevenueEntry.create({
            sourceEventId: 'evt_bucket_1',
            providerSubscriptionId: 'sub_annual',
            planCode: 'pro',
            bucketIndex: 2,
            recognitionMonth: '2026-05',
            recognizedAmountMinor: 500,
            currency: 'inr',
            paymentOccurredAt: new Date('2026-04-10T00:00:00.000Z'),
        })

        const summary = await computeFinancialYearRevenue('2026-27', new Date('2026-09-22T00:00:00.000Z'))

        expect(summary.totalsByCurrency).toEqual({ usd: 1000, inr: 500 })
        expect(summary.byMonth.find((m) => m.periodMonth === '2026-04')?.totalsByCurrency).toEqual({ usd: 1000 })
        expect(summary.byMonth.find((m) => m.periodMonth === '2026-05')?.totalsByCurrency).toEqual({ inr: 500 })
    })

    it('includes monthly-plan payments in the month they were paid', async () => {
        await seedSubscription('sub_monthly_fy', 'monthly')
        await seedPaymentEvent('sub_monthly_fy', new Date('2026-05-10T00:00:00.000Z'), { total: 700 })

        const summary = await computeFinancialYearRevenue('2026-27', new Date('2026-09-22T00:00:00.000Z'))

        expect(summary.totalsByCurrency.usd).toBe(700)
    })

    it('excludes a payment for a subscription outside the financial year window', async () => {
        await seedSubscription('sub_monthly_prior', 'monthly')
        await seedPaymentEvent('sub_monthly_prior', new Date('2026-02-10T00:00:00.000Z'), { total: 700 })

        const summary = await computeFinancialYearRevenue('2026-27', new Date('2026-09-22T00:00:00.000Z'))

        expect(summary.totalsByCurrency).toEqual({})
    })

    it('is empty for a financial year that has not started yet', async () => {
        const summary = await computeFinancialYearRevenue('2027-28', new Date('2026-09-22T00:00:00.000Z'))

        expect(summary.monthsIncluded).toEqual([])
        expect(summary.totalsByCurrency).toEqual({})
    })
})
