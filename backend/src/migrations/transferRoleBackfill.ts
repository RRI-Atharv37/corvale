import { Types } from 'mongoose'

import { Transaction } from '@modules/transactions'
import { SOFT_DELETE_BYPASS } from '@core/softDelete/softDelete'
import { isInboundTransferLeg } from '@shared/transferDirection'

export interface BackfillOptions {
    dryRun?: boolean
}

export interface BackfillResult {
    dryRun: boolean
    legsMatched: number
    legsModified: number
    orphanedLegs: number
}

interface LegRow {
    _id: Types.ObjectId
    transferPairId: Types.ObjectId
    createdAt: Date
}

const OPTIONS = { [SOFT_DELETE_BYPASS]: true }

/**
 * Backfills `transferRole` (BUG-67) on transfer legs written before the field existed, resolving each
 * pair once with the creation-order rule every reader used until now (later leg inbound, id breaks a
 * same-millisecond tie), so balances do not move. Tombstoned legs are included, since the sync pull
 * still serves them. A leg whose pair no longer exists is left alone and counted. Already-stamped
 * legs are excluded, so a re-run is a no-op. The writes bump `updatedAt`, which is what lets devices
 * pull the new field.
 */
export const backfillTransferRoles = async (options: BackfillOptions = {}): Promise<BackfillResult> => {
    const { dryRun = false } = options

    const filter = { type: 'transfer', transferPairId: { $ne: null }, transferRole: null }
    const result: BackfillResult = { dryRun, legsMatched: 0, legsModified: 0, orphanedLegs: 0 }
    const handled = new Set<string>()

    const cursor = Transaction.find(filter, null, OPTIONS)
        .select('transferPairId createdAt')
        .lean<LegRow[]>()
        .cursor()

    for await (const leg of cursor) {
        const legId = leg._id.toString()
        if (handled.has(legId)) {
            continue
        }

        const pair = await Transaction.findOne({ _id: leg.transferPairId }, null, OPTIONS)
            .select('transferPairId createdAt transferRole')
            .lean()
        if (!pair) {
            result.legsMatched += 1
            result.orphanedLegs += 1
            continue
        }

        const pairId = pair._id.toString()
        handled.add(legId)
        handled.add(pairId)

        const legIsInbound = isInboundTransferLeg(
            { id: legId, createdAt: leg.createdAt },
            { id: pairId, createdAt: pair.createdAt, transferRole: pair.transferRole }
        )
        const stamps: [Types.ObjectId, 'out' | 'in'][] = [[leg._id, legIsInbound ? 'in' : 'out']]
        if (!pair.transferRole) {
            stamps.push([pair._id, legIsInbound ? 'out' : 'in'])
        }
        result.legsMatched += stamps.length

        if (dryRun) {
            continue
        }

        for (const [id, transferRole] of stamps) {
            const updated = await Transaction.updateOne(
                { _id: id, transferRole: null },
                { $set: { transferRole } }
            ).setOptions(OPTIONS)
            result.legsModified += updated.modifiedCount
        }
    }

    return result
}
