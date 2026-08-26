import { Model } from 'mongoose'

import CategorizationRule from '../models/CategorizationRule'
import Notification from '../models/Notification'
import Receipt from '../models/Receipt'
import SavedReport from '../models/SavedReport'
import Saver from '../models/Saver'
import Tag from '../models/Tag'
import Transaction from '../models/Transaction'
import TransactionTemplate from '../models/TransactionTemplate'
import { SOFT_DELETE_BYPASS } from './softDelete'

/**
 * Retention floor for soft-deleted (tombstoned) records, in days. Must exceed
 * the maximum realistic offline window so a device that reconnects after
 * being offline still finds the tombstone during /sync/pull rather than
 * seeing the record simply vanish with no explanation.
 */
export const TOMBSTONE_RETENTION_DAYS = 90

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
 */
export const purgeExpiredTombstones = async (
    retentionDays: number = TOMBSTONE_RETENTION_DAYS
): Promise<TombstonePurgeResult[]> => {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)

    const results: TombstonePurgeResult[] = []
    for (const model of SOFT_DELETABLE_MODELS) {
        const outcome = await model
            .deleteMany({ deletedAt: { $ne: null, $lte: cutoff } })
            .setOptions({ [SOFT_DELETE_BYPASS]: true })
        results.push({ model: model.modelName, deletedCount: outcome.deletedCount ?? 0 })
    }

    return results
}
