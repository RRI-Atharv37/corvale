import type { LocalDb, LocalDbRow } from '../db/LocalDb'
import { tableInvalidationBus } from '@lib/tableInvalidationBus'
import type { OutboxOp, OutboxOperation, OutboxStore } from './outbox'

interface OutboxRow extends LocalDbRow {
    opId: string
    entity: string
    operation: string
    payload: string
    baseUpdatedAt: string | null
    createdAt: string
    attempts: number
    lastError: string | null
    nextAttemptAt: string | null
}

const rowToOp = (row: OutboxRow): OutboxOp => ({
    opId: row.opId,
    entity: row.entity,
    operation: row.operation as OutboxOperation,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    baseUpdatedAt: row.baseUpdatedAt ?? undefined,
    attempts: row.attempts,
    lastError: row.lastError,
    enqueuedAt: row.createdAt,
    nextAttemptAt: row.nextAttemptAt === null ? null : Number(row.nextAttemptAt),
})

/** Backs `Outbox` with the local SQLite `_outbox` table (see `sql/0001_init.sql`) instead of an in-memory Map. */
export const createSqliteOutboxStore = (db: LocalDb): OutboxStore => ({
    async insert(op) {
        await db.exec(
            `INSERT INTO _outbox (opId, entity, operation, payload, baseUpdatedAt, createdAt, attempts, lastError, nextAttemptAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                op.opId,
                op.entity,
                op.operation,
                JSON.stringify(op.payload),
                op.baseUpdatedAt ?? null,
                op.enqueuedAt,
                op.attempts,
                op.lastError,
                op.nextAttemptAt === null ? null : String(op.nextAttemptAt),
            ]
        )
        tableInvalidationBus.publish('_outbox')
    },

    async list() {
        const rows = await db.select<OutboxRow>('SELECT * FROM _outbox ORDER BY createdAt ASC, rowid ASC')
        return rows.map(rowToOp)
    },

    async update(opId, patch) {
        const sets: string[] = []
        const values: unknown[] = []

        if ('attempts' in patch) {
            sets.push('attempts = ?')
            values.push(patch.attempts)
        }
        if ('lastError' in patch) {
            sets.push('lastError = ?')
            values.push(patch.lastError ?? null)
        }
        if ('nextAttemptAt' in patch) {
            sets.push('nextAttemptAt = ?')
            values.push(patch.nextAttemptAt === null || patch.nextAttemptAt === undefined ? null : String(patch.nextAttemptAt))
        }
        if (sets.length === 0) {
            return
        }

        values.push(opId)
        await db.exec(`UPDATE _outbox SET ${sets.join(', ')} WHERE opId = ?`, values)
        tableInvalidationBus.publish('_outbox')
    },

    async remove(opId) {
        await db.exec('DELETE FROM _outbox WHERE opId = ?', [opId])
        tableInvalidationBus.publish('_outbox')
    },
})
