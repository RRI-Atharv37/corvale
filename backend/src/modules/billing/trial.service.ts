import type { Types } from 'mongoose'

import { RLS_BYPASS } from '@core/access/rowLevelSecurity'
import type { GrandfatherKind } from '@core/billing/constants'
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

const CREATE_CHUNK_SIZE = 50

export const findUserIdsWithoutSubscription = async (userIds: Types.ObjectId[]): Promise<Types.ObjectId[]> => {
    if (userIds.length === 0) return []

    const rows = await Subscription.find({ userId: { $in: userIds } }).select('userId').setOptions(BYPASS).lean<{ userId: Types.ObjectId }[]>()
    const covered = new Set(rows.map((row) => row.userId.toString()))
    return userIds.filter((userId) => !covered.has(userId.toString()))
}

/**
 * BUG-42: a user who registered while billing was off has no row, so they resolve to read-only the
 * moment billing goes on and no admin tool can reach them. Gives each such user the trial a new
 * account gets (30 days from `now`), optionally already grandfathered. Never touches an existing row
 * and works with billing off, since it runs before go-live. Returns the ids of the rows it created.
 */
export const createMissingTrialRows = async (
    userIds: Types.ObjectId[],
    options: { grandfatherKind?: GrandfatherKind | null; now?: Date } = {}
): Promise<Types.ObjectId[]> => {
    const { grandfatherKind = null, now = new Date() } = options
    const trial = { ...buildTrialSubscription(now), grandfatherKind }
    const created: Types.ObjectId[] = []

    for (let start = 0; start < userIds.length; start += CREATE_CHUNK_SIZE) {
        const results = await Promise.all(
            userIds.slice(start, start + CREATE_CHUNK_SIZE).map((userId) =>
                Subscription.updateOne({ userId }, { $setOnInsert: trial }, { upsert: true }).setOptions(BYPASS)
            )
        )
        for (const result of results) if (result.upsertedId) created.push(result.upsertedId as Types.ObjectId)
    }

    if (grandfatherKind === null && created.length > 0) await recordMetric('trialStarted', created.length, now)
    return created
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
