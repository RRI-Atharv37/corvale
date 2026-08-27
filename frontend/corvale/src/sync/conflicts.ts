import type { LocalDb, LocalDbRow } from '../db/LocalDb'
import { tableInvalidationBus } from '../db/invalidation/tableInvalidationBus'
import { Repository, type SyncableRecord } from '../db/repositories/Repository'
import { ENTITY_TO_TABLE, type SyncEntityName } from './entityMap'
import { createOutbox } from './outbox'
import { createSqliteOutboxStore } from './sqliteOutboxStore'

export interface Conflict {
    id: string
    entity: SyncEntityName
    recordId: string
    localData: Record<string, unknown>
    serverData: SyncableRecord
    detectedAt: string
}

interface ConflictRow extends LocalDbRow {
    id: string
    entity: string
    recordId: string
    localData: string
    serverData: string
    detectedAt: string
    resolvedAt: string | null
}

const rowToConflict = (row: ConflictRow): Conflict => ({
    id: row.id,
    entity: row.entity as SyncEntityName,
    recordId: row.recordId,
    localData: JSON.parse(row.localData) as Record<string, unknown>,
    serverData: JSON.parse(row.serverData) as SyncableRecord,
    detectedAt: row.detectedAt,
})

/** Records a push conflict into `_conflicts` (see `sql/0001_init.sql`) for the "Sync issues" inbox to surface. */
export const recordConflict = async (
    db: LocalDb,
    input: { entity: SyncEntityName; recordId: string; localData: Record<string, unknown>; serverData: SyncableRecord }
): Promise<void> => {
    await db.exec(
        `INSERT INTO _conflicts (id, entity, recordId, localData, serverData, detectedAt, resolvedAt)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
        [
            crypto.randomUUID(),
            input.entity,
            input.recordId,
            JSON.stringify(input.localData),
            JSON.stringify(input.serverData),
            new Date().toISOString(),
        ]
    )
    tableInvalidationBus.publish('_conflicts')
}

export const listUnresolvedConflicts = async (db: LocalDb): Promise<Conflict[]> => {
    const rows = await db.select<ConflictRow>(
        'SELECT * FROM _conflicts WHERE resolvedAt IS NULL ORDER BY detectedAt ASC'
    )
    return rows.map(rowToConflict)
}

type ConflictResolution = 'keep-mine' | 'keep-server'

/**
 * Resolves a conflict per the ROADMAP rule "money fields never field-merged":
 * `keep-server` simply accepts the server's document as-is (it's already the
 * source of truth locally isn't touched further); `keep-mine` re-enqueues the
 * local version as a fresh `update` op, rebased on the server's `updatedAt` so
 * it applies cleanly on the next flush instead of racing the same conflict.
 */
export const resolveConflict = async (
    db: LocalDb,
    conflictId: string,
    resolution: ConflictResolution
): Promise<void> => {
    const [row] = await db.select<ConflictRow>('SELECT * FROM _conflicts WHERE id = ?', [conflictId])
    if (!row) {
        return
    }
    const conflict = rowToConflict(row)

    if (resolution === 'keep-server') {
        const table = ENTITY_TO_TABLE[conflict.entity]
        await new Repository(table).upsertFromServer(db, [conflict.serverData])
        tableInvalidationBus.publish(table)
    } else {
        const outbox = createOutbox(createSqliteOutboxStore(db))
        await outbox.enqueue({
            entity: `${conflict.entity}:${conflict.recordId}`,
            operation: 'update',
            payload: conflict.localData,
            baseUpdatedAt: conflict.serverData.updatedAt,
        })
    }

    await db.exec('UPDATE _conflicts SET resolvedAt = ? WHERE id = ?', [new Date().toISOString(), conflictId])
    tableInvalidationBus.publish('_conflicts')
}
