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
        payload: { providerSubscriptionId, total: 12000, currency: 'USD', interval: 'annual', planCode: 'pro', ...payload },
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
        const event = await seedPaymentEvent('sub_annual')

        const result = await runRevenueRecognitionSweep()

        expect(result.skipped).toBe(false)
        expect(result.claimed).toBe(1)
        expect(result.entriesCreated).toBe(12)

        const entries = await DeferredRevenueEntry.find({ sourceEventId: event.providerEventId }).sort({ bucketIndex: 1 }).lean()
        expect(entries).toHaveLength(12)
        expect(entries.map((entry) => entry.bucketIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
        expect(entries.reduce((sum, entry) => sum + entry.recognizedAmountMinor, 0)).toBe(12000)
        expect(entries.every((entry) => entry.currency === 'USD')).toBe(true)
        expect(entries.every((entry) => entry.planCode === 'pro')).toBe(true)
        expect(entries[0].recognitionMonth).toBe('2026-11')
        expect(entries[11].recognitionMonth).toBe('2027-10')
    })

    it('stores no provider identifier on any entry (SEC-74)', async () => {
        enableFinanceOps()
        await seedAnnualSubscription('sub_no_ids')
        await seedPaymentEvent('sub_no_ids')

        await runRevenueRecognitionSweep()

        const raw = await DeferredRevenueEntry.collection.find({}).toArray()
        expect(raw).toHaveLength(12)
        expect(JSON.stringify(raw)).not.toContain('sub_no_ids')
        expect(raw.every((entry) => !('providerSubscriptionId' in entry))).toBe(true)
    })

    it('claims a monthly-interval payment but recognizes nothing', async () => {
        enableFinanceOps()
        await seedAnnualSubscription('sub_monthly', { interval: 'monthly' })
        await seedPaymentEvent('sub_monthly', { interval: 'monthly' })

        const result = await runRevenueRecognitionSweep()

        expect(result.claimed).toBe(1)
        expect(result.entriesCreated).toBe(0)
        expect(await DeferredRevenueEntry.countDocuments({})).toBe(0)
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

    it('recognizes an annual payment whose subscription row no longer exists (BUG-45)', async () => {
        enableFinanceOps()
        await seedPaymentEvent('sub_unknown')

        const result = await runRevenueRecognitionSweep()

        expect(result.claimed).toBe(1)
        expect(result.entriesCreated).toBe(12)
    })

    it('claims a payment whose price could not be classified, recognizes nothing and does not fall back to the subscription row', async () => {
        enableFinanceOps()
        await seedAnnualSubscription('sub_unclassified')
        const event = await seedPaymentEvent('sub_unclassified', { interval: undefined, planCode: undefined })

        const result = await runRevenueRecognitionSweep()

        expect(result.claimed).toBe(1)
        expect(result.entriesCreated).toBe(0)
        expect((await BillingEvent.findOne({ providerEventId: event.providerEventId }).lean())?.revenueRecognizedAt).not.toBeNull()
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
        expect(await DeferredRevenueEntry.countDocuments({})).toBe(12)
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

    describe('classifies from the payment itself, not from the subscription as it is now (BUG-45)', () => {
        it('recognizes an annual payment after the subscriber switched to monthly', async () => {
            enableFinanceOps()
            await seedAnnualSubscription('sub_switched_down', { interval: 'monthly' })
            const event = await seedPaymentEvent('sub_switched_down')

            const result = await runRevenueRecognitionSweep()

            expect(result.entriesCreated).toBe(12)
            const entries = await DeferredRevenueEntry.find({ sourceEventId: event.providerEventId }).lean()
            expect(entries.reduce((sum, entry) => sum + entry.recognizedAmountMinor, 0)).toBe(12000)
        })

        it('does not spread a monthly payment over a year because the subscription is annual now', async () => {
            enableFinanceOps()
            await seedAnnualSubscription('sub_switched_up', { interval: 'annual' })
            await seedPaymentEvent('sub_switched_up', { interval: 'monthly', total: 1000 })

            const result = await runRevenueRecognitionSweep()

            expect(result.claimed).toBe(1)
            expect(result.entriesCreated).toBe(0)
        })

        it('classifies history by what was paid when finance ops is switched on after the subscription changed', async () => {
            await seedAnnualSubscription('sub_late_enable', { interval: 'monthly', planCode: 'pro' })
            await seedPaymentEvent('sub_late_enable')
            await seedPaymentEvent('sub_late_enable', { total: 1000, interval: 'monthly' })
            expect((await runRevenueRecognitionSweep()).skipped).toBe(true)

            enableFinanceOps()
            const result = await runRevenueRecognitionSweep()

            expect(result.claimed).toBe(2)
            expect(result.entriesCreated).toBe(12)
        })

        it('recognizes an annual payment after its payer erased their account and the ledger lost the provider ids', async () => {
            enableFinanceOps()
            const event = await seedPaymentEvent('sub_erased')
            await BillingEvent.collection.updateOne(
                { providerEventId: event.providerEventId },
                { $unset: { 'payload.providerSubscriptionId': '', 'payload.providerCustomerId': '' }, $set: { redactedAt: new Date() } }
            )

            const result = await runRevenueRecognitionSweep()

            expect(result.entriesCreated).toBe(12)
        })
    })

    it('stores the currency uppercase whatever case the ledger carried', async () => {
        enableFinanceOps()
        const event = await seedPaymentEvent('sub_lower_currency', { currency: 'usd' })

        await runRevenueRecognitionSweep()

        const entries = await DeferredRevenueEntry.find({ sourceEventId: event.providerEventId }).lean()
        expect(entries.every((entry) => entry.currency === 'USD')).toBe(true)
    })
})
