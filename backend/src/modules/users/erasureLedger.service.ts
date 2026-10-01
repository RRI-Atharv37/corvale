import { createHmac } from 'crypto'

import ErasureLedger from './erasureLedger.model'

export const ERASURE_LEDGER_RETENTION_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000
const FALLBACK_KEY = 'corvale-erasure-ledger-v1'

/**
 * SEC-94: the keyed hash is the only thing kept about an erased account. `ERASURE_LEDGER_KEY` must
 * stay stable for the backup window (30 days): rotating it orphans the ledger, so it is not derived
 * from `JWT_SECRET`, which the breach runbook rotates.
 */
export const computeErasureId = (userId: string): string =>
    createHmac('sha256', process.env.ERASURE_LEDGER_KEY || FALLBACK_KEY)
        .update(String(userId))
        .digest('hex')

export const recordErasure = async (userId: string): Promise<void> => {
    const erasedAt = new Date()
    const expiresAt = new Date(erasedAt.getTime() + ERASURE_LEDGER_RETENTION_DAYS * DAY_MS)
    await ErasureLedger.updateOne(
        { idHash: computeErasureId(userId) },
        { $setOnInsert: { erasedAt, expiresAt } },
        { upsert: true }
    )
}
