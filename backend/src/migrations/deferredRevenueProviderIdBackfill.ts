import { DeferredRevenueEntry } from '@modules/billing'

export interface BackfillOptions {
    dryRun?: boolean
}

export interface BackfillResult {
    dryRun: boolean
    matched: number
    modified: number
}

/**
 * SEC-74: rows written before `providerSubscriptionId` was dropped from `DeferredRevenueEntry` still
 * carry it. The collection refuses every Mongoose update, so this one-off goes through the native
 * driver and unsets that single field.
 */
export const removeDeferredRevenueProviderIds = async (options: BackfillOptions = {}): Promise<BackfillResult> => {
    const { dryRun = false } = options

    const filter = { providerSubscriptionId: { $exists: true } }
    const matched = await DeferredRevenueEntry.collection.countDocuments(filter)

    if (dryRun) {
        return { dryRun: true, matched, modified: 0 }
    }

    const result = await DeferredRevenueEntry.collection.updateMany(filter, { $unset: { providerSubscriptionId: '' } })

    return { dryRun: false, matched, modified: result.modifiedCount }
}
