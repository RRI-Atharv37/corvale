import { RLS_BYPASS } from '@core/access/rowLevelSecurity'
import { buildTrialSubscription } from '@core/billing/entitlements'
import { isDuplicateKeyError } from '@core/db/objectId'

import { isBillingEnabled } from './entitlement.service'
import { recordMetric } from './metrics.service'
import Subscription from './subscription.model'

const BYPASS = { [RLS_BYPASS]: true }

/**
 * Starts the one trial a user ever gets. Any existing row - trialing, lapsed or paying - means no
 * new trial, so signing up again or calling this twice cannot farm one. No-op while billing is off.
 */
export const startTrialIfEligible = async (userId: string, now: Date = new Date()): Promise<boolean> => {
    if (!isBillingEnabled()) return false

    let started: boolean
    try {
        const result = await Subscription.updateOne({ userId }, { $setOnInsert: buildTrialSubscription(now) }, { upsert: true }).setOptions(BYPASS)
        started = result.upsertedCount === 1
    } catch (error) {
        if (isDuplicateKeyError(error)) return false
        throw error
    }
    if (started) await recordMetric('trialStarted', 1, now)
    return started
}

/**
 * Persists what the resolver already derives from the clock, so reports and the entitlement
 * snapshot agree with the stored row. Expiry only ever flips the status: nothing is deleted.
 */
export const expireLapsedTrials = async (now: Date = new Date()): Promise<{ expired: number }> => {
    if (!isBillingEnabled()) return { expired: 0 }

    const result = await Subscription.updateMany(
        {
            status: 'trialing',
            trialEndsAt: { $ne: null, $lte: now },
            grandfatherKind: { $ne: 'free_forever' },
        },
        { $set: { status: 'trial_expired' } }
    ).setOptions(BYPASS)

    if (result.modifiedCount > 0) await recordMetric('trialExpired', result.modifiedCount, now)
    return { expired: result.modifiedCount }
}
