import type { Types } from 'mongoose'

import type { GrandfatherKind } from '@core/billing/constants'
import { createMissingTrialRows, findUserIdsWithoutSubscription } from '@modules/billing'
import { User } from '@modules/users'

export interface SubscriptionBackfillOptions {
    dryRun?: boolean
    grandfatherKind?: GrandfatherKind | null
    now?: Date
}

export interface SubscriptionBackfillResult {
    dryRun: boolean
    users: number
    missing: number
    created: number
}

const PAGE_SIZE = 500

/**
 * BUG-42: run once, right before `BILLING_ENABLED` is switched on. Every user without a subscription
 * row (everyone who registered while billing was off) gets the 30-day trial from now, or is
 * grandfathered as they are created when a kind is given. Idempotent: users who already have a row are
 * left alone, so a re-run just picks up anyone who registered since.
 */
export const backfillSubscriptionRows = async (options: SubscriptionBackfillOptions = {}): Promise<SubscriptionBackfillResult> => {
    const { dryRun = false, grandfatherKind = null, now = new Date() } = options
    const result: SubscriptionBackfillResult = { dryRun, users: 0, missing: 0, created: 0 }

    let after: Types.ObjectId | null = null
    for (;;) {
        const page: { _id: Types.ObjectId }[] = await User.find(after ? { _id: { $gt: after } } : {})
            .select('_id')
            .sort({ _id: 1 })
            .limit(PAGE_SIZE)
            .lean<{ _id: Types.ObjectId }[]>()
        if (page.length === 0) break

        const userIds = page.map((row) => row._id)
        const missing = await findUserIdsWithoutSubscription(userIds)
        result.users += userIds.length
        result.missing += missing.length
        if (!dryRun && missing.length > 0) result.created += (await createMissingTrialRows(missing, { grandfatherKind, now })).length

        after = userIds[userIds.length - 1]
    }

    return result
}
