import User from '../models/User'

export interface BackfillOptions {
    dryRun?: boolean
}

export interface BackfillResult {
    dryRun: boolean
    matched: number
    modified: number
}

/**
 * Grandfathers in every account that existed before email verification shipped: they're
 * marked verified so only new signups after this deploy are required to verify. Matches on
 * `$exists: false` rather than `isEmailVerified: false` so a user who is genuinely unverified
 * post-deploy (mid-signup) is never accidentally swept up by a later re-run.
 */
export const backfillEmailVerification = async (options: BackfillOptions = {}): Promise<BackfillResult> => {
    const { dryRun = false } = options

    const filter = { isEmailVerified: { $exists: false } }
    const matched = await User.countDocuments(filter)

    if (dryRun) {
        return { dryRun: true, matched, modified: 0 }
    }

    const result = await User.updateMany(filter, { $set: { isEmailVerified: true } })

    return { dryRun: false, matched, modified: result.modifiedCount }
}
