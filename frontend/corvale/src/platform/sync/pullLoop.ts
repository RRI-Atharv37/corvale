import type { LocalDb } from '../db/LocalDb'
import { tableInvalidationBus } from '@lib/tableInvalidationBus'
import { Repository, type SyncableTableName } from '../db/repositories/Repository'
import { ENTITY_TO_TABLE, type SyncEntityName } from './entityMap'
import { fetchPullPage } from './syncApi'

const CHECKPOINT_KEY = 'checkpoint'

const REPOSITORIES: Record<SyncEntityName, Repository<never>> = Object.fromEntries(
    (Object.keys(ENTITY_TO_TABLE) as SyncEntityName[]).map((entity) => [
        entity,
        new Repository(ENTITY_TO_TABLE[entity] as SyncableTableName),
    ])
) as Record<SyncEntityName, Repository<never>>

export const getCheckpoint = async (db: LocalDb): Promise<string | null> => {
    const rows = await db.select<{ value: string }>('SELECT value FROM _sync_meta WHERE key = ?', [CHECKPOINT_KEY])
    return rows[0]?.value ?? null
}

const setCheckpoint = async (db: LocalDb, checkpoint: string): Promise<void> => {
    await db.exec(
        `INSERT INTO _sync_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [CHECKPOINT_KEY, checkpoint]
    )
}

/**
 * Pulls every page since the persisted checkpoint, applying changes and tombstones inside one
 * transaction per page so a crash mid-pull resumes from the last *committed* checkpoint rather than
 * replaying (harmless - pull is idempotent) or silently dropping a partially-applied page.
 */
export const runPullLoop = async (db: LocalDb, workspaceId: string | null | undefined): Promise<void> => {
    let checkpoint = await getCheckpoint(db)
    const touchedTables = new Set<string>()

    let hasMore = true
    while (hasMore) {
        const page = await fetchPullPage(workspaceId, checkpoint)

        await db.transaction(async (tx) => {
            for (const change of page.changes) {
                const entity = change.entity as SyncEntityName
                const repository = REPOSITORIES[entity]
                if (!repository) continue
                await repository.upsertFromServer(tx, [change.doc as never])
                touchedTables.add(ENTITY_TO_TABLE[entity])
            }
            for (const tombstone of page.tombstones) {
                const entity = tombstone.entity as SyncEntityName
                const repository = REPOSITORIES[entity]
                if (!repository) continue
                await repository.applyTombstone(tx, tombstone._id, tombstone.deletedAt)
                touchedTables.add(ENTITY_TO_TABLE[entity])
            }
            await setCheckpoint(tx, page.checkpoint)
        })

        checkpoint = page.checkpoint
        hasMore = page.hasMore
    }

    for (const table of touchedTables) {
        tableInvalidationBus.publish(table)
    }
}
