import { Model } from 'mongoose'

import CategorizationRule from '../models/CategorizationRule'
import Notification from '../models/Notification'
import Receipt from '../models/Receipt'
import SavedReport from '../models/SavedReport'
import Saver from '../models/Saver'
import Tag from '../models/Tag'
import Transaction from '../models/Transaction'
import TransactionTemplate from '../models/TransactionTemplate'
import { SOFT_DELETE_BYPASS, TOMBSTONE_RETENTION_DAYS } from './softDelete'

export { TOMBSTONE_RETENTION_DAYS }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SOFT_DELETABLE_MODELS: Model<any>[] = [
    Transaction,
    Tag,
    Receipt,
    TransactionTemplate,
    CategorizationRule,
    SavedReport,
    Saver,
    Notification,
]

export interface TombstonePurgeResult {
    model: string
    deletedCount: number
}

/**
 * Permanently removes tombstones (deletedAt set) older than the retention
 * window. Runs outside any RLS context (a cron/CLI job, not a request), so
 * it intentionally bypasses per-user scoping — it purges across all users by
 * design, the same way the RLS plugin already treats un-scoped code paths
 * that never enter runWithRlsContext.
 *
 * SEC-54: a non-positive / non-finite retention window is rejected outright — `0` would
 * permanently purge every tombstone for every user. `dryRun` counts the matching rows
 * without deleting anything.
 */
export const purgeExpiredTombstones = async (
    retentionDays: number = TOMBSTONE_RETENTION_DAYS,
    options: { dryRun?: boolean } = {}
): Promise<TombstonePurgeResult[]> => {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
        throw new Error(
            `Invalid retention window: ${retentionDays}. --retention-days must be a positive number.`
        )
    }

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
    const filter = { deletedAt: { $ne: null, $lte: cutoff } }

    const results: TombstonePurgeResult[] = []
    for (const model of SOFT_DELETABLE_MODELS) {
        const deletedCount = options.dryRun
            ? await model.countDocuments(filter).setOptions({ [SOFT_DELETE_BYPASS]: true })
            : (
                  await model
                      .deleteMany(filter)
                      .setOptions({ [SOFT_DELETE_BYPASS]: true })
              ).deletedCount ?? 0
        results.push({ model: model.modelName, deletedCount })
    }

    return results
}
