import { beforeEach, describe, expect, it } from 'vitest'

import { Types } from 'mongoose'

import BillingEvent from '../billingEvent.model'
import DeferredRevenueEntry from '../deferredRevenueEntry.model'
import Subscription from '../subscription.model'
import { runRevenueRecognitionSweep } from '../revenueRecognition.service'

/**
 * M8e - the deferred-revenue sweep. Decoupled from `webhookEventHandlers.ts` on purpose: it reads
 * the already-recorded `BillingEvent` ledger rather than hooking the live `payment.succeeded`
 * handler, so these tests seed `BillingEvent`/`Subscription` rows directly instead of posting a
 * webhook.
 */

const enableFinanceOps = (): void => {
    process.env.FINANCE_OPS_ENABLED = 'true'
}
const disableFinanceOps = (): void => {
    delete process.env.FINANCE_OPS_ENABLED
}

let eventCounter = 0
const nextEventId = (): string => {
    eventCounter += 1
    return `evt_recog_${eventCounter}`
}

const seedAnnualSubscription = (providerSubscriptionId: string, overrides: Record<string, unknown> = {}) =>
    Subscription.create({
        userId: new Types.ObjectId(),
        planCode: 'pro',
        status: 'active',
        interval: 'annual',
        providerSubscriptionId,
        providerCustomerId: `cus_${providerSubscriptionId}`,
        ...overrides,
    })

const seedPaymentEvent = (providerSubscriptionId: string, payload: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) => {
    const providerEventId = nextEventId()
    return BillingEvent.create({
        providerEventId,
        type: 'payment.succeeded',
        occurredAt: new Date('2026-11-20T12:00:00.000Z'),
        payload: { providerSubscriptionId, total: 12000, currency: 'usd', ...payload },
        ...overrides,
    })
}

beforeEach(() => {
    disableFinanceOps()
})

describe('runRevenueRecognitionSweep', () => {
    it('is a no-op while FINANCE_OPS_ENABLED is not true, and never claims the event', async () => {
        await seedAnnualSubscription('sub_off')
        await seedPaymentEvent('sub_off')

        const result = await runRevenueRecognitionSweep()

        expect(result).toEqual({ skipped: true, claimed: 0, entriesCreated: 0 })
        expect(await DeferredRevenueEntry.countDocuments({})).toBe(0)
        const event = await BillingEvent.findOne({ 'payload.providerSubscriptionId': 'sub_off' }).lean()
        expect(event?.revenueRecognizedAt).toBeNull()
    })

    it('splits an annual payment into 12 monthly entries summing to the total', async () => {
        enableFinanceOps()
        await seedAnnualSubscription('sub_annual')
        await seedPaymentEvent('sub_annual')

        const result = await runRevenueRecognitionSweep()

        expect(result.skipped).toBe(false)
        expect(result.claimed).toBe(1)
        expect(result.entriesCreated).toBe(12)

        const entries = await DeferredRevenueEntry.find({ providerSubscriptionId: 'sub_annual' }).sort({ bucketIndex: 1 }).lean()
        expect(entries).toHaveLength(12)
        expect(entries.map((entry) => entry.bucketIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
        expect(entries.reduce((sum, entry) => sum + entry.recognizedAmountMinor, 0)).toBe(12000)
        expect(entries.every((entry) => entry.currency === 'usd')).toBe(true)
        expect(entries.every((entry) => entry.planCode === 'pro')).toBe(true)
        expect(entries[0].recognitionMonth).toBe('2026-11')
        expect(entries[11].recognitionMonth).toBe('2027-10')
    })

    it('claims a monthly-interval payment but recognizes nothing', async () => {
        enableFinanceOps()
        await seedAnnualSubscription('sub_monthly', { interval: 'monthly' })
        await seedPaymentEvent('sub_monthly')

        const result = await runRevenueRecognitionSweep()

        expect(result.claimed).toBe(1)
        expect(result.entriesCreated).toBe(0)
        expect(await DeferredRevenueEntry.countDocuments({ providerSubscriptionId: 'sub_monthly' })).toBe(0)
        const event = await BillingEvent.findOne({ 'payload.providerSubscriptionId': 'sub_monthly' }).lean()
        expect(event?.revenueRecognizedAt).not.toBeNull()
    })

    it('claims a refunded payment but recognizes nothing', async () => {
        enableFinanceOps()
        await seedAnnualSubscription('sub_refunded')
        await seedPaymentEvent('sub_refunded', { refunded: true })

        const result = await runRevenueRecognitionSweep()

        expect(result.claimed).toBe(1)
        expect(result.entriesCreated).toBe(0)
    })

    it('claims a payment with no matching subscription but recognizes nothing', async () => {
        enableFinanceOps()
        await seedPaymentEvent('sub_unknown')

        const result = await runRevenueRecognitionSweep()

        expect(result.claimed).toBe(1)
        expect(result.entriesCreated).toBe(0)
    })

    it('ignores event types other than payment.succeeded', async () => {
        enableFinanceOps()
        await seedAnnualSubscription('sub_other_type')
        await BillingEvent.create({
            providerEventId: nextEventId(),
            type: 'subscription.updated',
            occurredAt: new Date(),
            payload: { providerSubscriptionId: 'sub_other_type', total: 12000, currency: 'usd' },
        })

        const result = await runRevenueRecognitionSweep()

        expect(result.claimed).toBe(0)
        expect(result.entriesCreated).toBe(0)
    })

    it('is idempotent: a second run does not reclaim or duplicate entries', async () => {
        enableFinanceOps()
        await seedAnnualSubscription('sub_idempotent')
        await seedPaymentEvent('sub_idempotent')

        const first = await runRevenueRecognitionSweep()
        const second = await runRevenueRecognitionSweep()

        expect(first.entriesCreated).toBe(12)
        expect(second).toEqual({ skipped: false, claimed: 0, entriesCreated: 0 })
        expect(await DeferredRevenueEntry.countDocuments({ providerSubscriptionId: 'sub_idempotent' })).toBe(12)
    })

    it('processes multiple pending payments independently in one sweep', async () => {
        enableFinanceOps()
        await seedAnnualSubscription('sub_multi_a')
        await seedAnnualSubscription('sub_multi_b')
        await seedPaymentEvent('sub_multi_a')
        await seedPaymentEvent('sub_multi_b')

        const result = await runRevenueRecognitionSweep()

        expect(result.claimed).toBe(2)
        expect(result.entriesCreated).toBe(24)
    })
})
