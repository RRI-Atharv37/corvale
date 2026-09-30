import type { LocalDb } from '../db/LocalDb'
import { tableInvalidationBus } from '@lib/tableInvalidationBus'
import { ENTITY_TO_TABLE, type SyncEntityName } from './entityMap'
import { getSyncRepository } from './syncRepositories'
import { getCheckpoint, setCheckpoint } from './checkpointStore'
import { fetchPullPage } from './syncApi'

/**
 * Pulls every page since the persisted checkpoint of this scope, applying changes and tombstones
 * inside one transaction per page so a crash mid-pull resumes from the last *committed* checkpoint
 * rather than replaying (harmless - pull is idempotent) or silently dropping a partially-applied
 * page. Each scope (personal, or one workspace) keeps its own checkpoint and a scope with none yet
 * pulls from the beginning (BUG-55).
 */
export const runPullLoop = async (db: LocalDb, workspaceId: string | null | undefined): Promise<void> => {
    let checkpoint = await getCheckpoint(db, workspaceId)
    const touchedTables = new Set<string>()

    let hasMore = true
    while (hasMore) {
        const page = await fetchPullPage(workspaceId, checkpoint)

        await db.transaction(async (tx) => {
            const docsByEntity = new Map<SyncEntityName, unknown[]>()
            for (const change of page.changes) {
                const entity = change.entity as SyncEntityName
                const docs = docsByEntity.get(entity) ?? []
                docs.push(change.doc)
                docsByEntity.set(entity, docs)
            }
            for (const [entity, docs] of docsByEntity) {
                const repository = getSyncRepository(entity)
                if (!repository) continue
                await repository.upsertFromServer(tx, docs as never[])
                touchedTables.add(ENTITY_TO_TABLE[entity])
            }
            for (const tombstone of page.tombstones) {
                const entity = tombstone.entity as SyncEntityName
                const repository = getSyncRepository(entity)
                if (!repository) continue
                await repository.applyTombstone(tx, tombstone._id, tombstone.deletedAt)
                touchedTables.add(ENTITY_TO_TABLE[entity])
            }
            await setCheckpoint(tx, workspaceId, page.checkpoint)
        })

        checkpoint = page.checkpoint
        hasMore = page.hasMore
    }

    for (const table of touchedTables) {
        tableInvalidationBus.publish(table)
    }
}
