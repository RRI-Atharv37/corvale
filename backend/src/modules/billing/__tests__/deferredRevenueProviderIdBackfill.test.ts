import { describe, expect, it } from 'vitest'

import { removeDeferredRevenueProviderIds } from '@migrations/deferredRevenueProviderIdBackfill'

import DeferredRevenueEntry from '../deferredRevenueEntry.model'

/**
 * SEC-74 - rows written before the field was dropped still carry `providerSubscriptionId` in the
 * database. The collection is append-only through Mongoose, so the one-off backfill goes through the
 * native driver, and only ever unsets that one field.
 */

const seedLegacyRow = (bucketIndex: number, withProviderId: boolean) =>
    DeferredRevenueEntry.collection.insertOne({
        sourceEventId: `evt_legacy_${bucketIndex}`,
        ...(withProviderId ? { providerSubscriptionId: `sub_legacy_${bucketIndex}` } : {}),
        planCode: 'pro',
        bucketIndex,
        recognitionMonth: '2026-09',
        recognizedAmountMinor: 1000,
        currency: 'usd',
        paymentOccurredAt: new Date('2026-09-05T00:00:00.000Z'),
    })

describe('removeDeferredRevenueProviderIds', () => {
    it('reports what it would change on a dry run and changes nothing', async () => {
        await seedLegacyRow(1, true)
        await seedLegacyRow(2, true)
        await seedLegacyRow(3, false)

        const result = await removeDeferredRevenueProviderIds({ dryRun: true })

        expect(result).toEqual({ dryRun: true, matched: 2, modified: 0 })
        expect(await DeferredRevenueEntry.collection.countDocuments({ providerSubscriptionId: { $exists: true } })).toBe(2)
    })

    it('unsets the provider id from every legacy row and leaves the rest of each row intact', async () => {
        await seedLegacyRow(1, true)
        await seedLegacyRow(2, true)
        await seedLegacyRow(3, false)

        const result = await removeDeferredRevenueProviderIds()

        expect(result).toEqual({ dryRun: false, matched: 2, modified: 2 })
        const rows = await DeferredRevenueEntry.collection.find({}).sort({ bucketIndex: 1 }).toArray()
        expect(rows).toHaveLength(3)
        expect(rows.every((row) => !('providerSubscriptionId' in row))).toBe(true)
        expect(rows[0]).toMatchObject({
            sourceEventId: 'evt_legacy_1',
            planCode: 'pro',
            recognitionMonth: '2026-09',
            recognizedAmountMinor: 1000,
            currency: 'usd',
        })
    })

    it('is idempotent', async () => {
        await seedLegacyRow(1, true)

        await removeDeferredRevenueProviderIds()

        expect(await removeDeferredRevenueProviderIds()).toEqual({ dryRun: false, matched: 0, modified: 0 })
    })

    it('does not loosen append-only for anything else', async () => {
        await seedLegacyRow(1, false)

        await expect(DeferredRevenueEntry.updateMany({}, { $set: { recognizedAmountMinor: 1 } })).rejects.toThrow(/append-only/)
        await expect(DeferredRevenueEntry.deleteMany({})).rejects.toThrow(/append-only/)
    })
})
