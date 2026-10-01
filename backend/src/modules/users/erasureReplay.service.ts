import ErasureLedger from './erasureLedger.model'
import User from './user.model'
import { computeErasureId } from './erasureLedger.service'
import { deleteUserAccountCascade } from './accountDeletionUtils'

export interface ReplayResult {
    matched: number
    erased: number
}

/**
 * Re-erases every account a restore brought back that the ledger lists. Safe to re-run: the cascade
 * is idempotent and `recordErasure` keeps the original erasure time.
 */
export const replayErasures = async ({ dryRun = false }: { dryRun?: boolean } = {}): Promise<ReplayResult> => {
    const hashes = new Set((await ErasureLedger.find({}, 'idHash').lean()).map((row) => row.idHash))
    if (hashes.size === 0) return { matched: 0, erased: 0 }

    const matchedIds: string[] = []
    for await (const user of User.find({}, '_id').lean().cursor()) {
        const id = user._id.toString()
        if (hashes.has(computeErasureId(id))) matchedIds.push(id)
    }

    if (dryRun) return { matched: matchedIds.length, erased: 0 }

    for (const id of matchedIds) await deleteUserAccountCascade(id)
    return { matched: matchedIds.length, erased: matchedIds.length }
}
