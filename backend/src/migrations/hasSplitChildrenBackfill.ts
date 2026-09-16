import { Types } from 'mongoose'

import { Transaction } from '@modules/transactions'

export interface BackfillOptions {
    dryRun?: boolean
}

export interface BackfillResult {
    dryRun: boolean
    parentsMatched: number
    parentsModified: number
}

/**
 * Backfills `hasSplitChildren` (BUG-34) on split parents created before the field existed.
 * A parent is any transaction id that appears as another transaction's `splitTransactionId` -
 * the same relationship `fetchSplitChildren` already reads at request time, just aggregated once
 * here instead of a per-row query. Already-flagged parents are excluded so a re-run is a no-op.
 */
export const backfillHasSplitChildren = async (options: BackfillOptions = {}): Promise<BackfillResult> => {
    const { dryRun = false } = options

    const parentIds: Types.ObjectId[] = await Transaction.distinct('splitTransactionId', {
        splitTransactionId: { $ne: null },
    })

    const filter = { _id: { $in: parentIds }, hasSplitChildren: { $ne: true } }
    const parentsMatched = await Transaction.countDocuments(filter)

    if (dryRun) {
        return { dryRun: true, parentsMatched, parentsModified: 0 }
    }

    const result = await Transaction.updateMany(filter, { $set: { hasSplitChildren: true } })

    return { dryRun: false, parentsMatched, parentsModified: result.modifiedCount }
}
