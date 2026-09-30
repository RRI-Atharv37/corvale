import type { LocalDb } from '../db/LocalDb'

const LEGACY_KEY = 'checkpoint'
const KEY_PREFIX = 'checkpoint:'

export const checkpointKey = (workspaceId: string | null | undefined): string =>
    `${KEY_PREFIX}${workspaceId ? `ws:${workspaceId}` : 'personal'}`

export const getCheckpoint = async (db: LocalDb, workspaceId: string | null | undefined): Promise<string | null> => {
    const rows = await db.select<{ value: string }>('SELECT value FROM _sync_meta WHERE key = ?', [
        checkpointKey(workspaceId),
    ])
    return rows[0]?.value ?? null
}

/**
 * Drops the pre-scope single `checkpoint` row in the same write: it was shared by every scope, so
 * which scope it belonged to is unknowable, and each scope re-pulls from the beginning instead.
 */
export const setCheckpoint = async (
    db: LocalDb,
    workspaceId: string | null | undefined,
    checkpoint: string
): Promise<void> => {
    await db.exec(
        `INSERT INTO _sync_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [checkpointKey(workspaceId), checkpoint]
    )
    await db.exec('DELETE FROM _sync_meta WHERE key = ?', [LEGACY_KEY])
}

/** True once any scope (or the legacy single row) has been bootstrapped or pulled on this store. */
export const hasAnyCheckpoint = async (db: LocalDb): Promise<boolean> => {
    const rows = await db.select<{ key: string }>('SELECT key FROM _sync_meta WHERE key = ? OR key LIKE ? LIMIT 1', [
        LEGACY_KEY,
        `${KEY_PREFIX}%`,
    ])
    return rows.length > 0
}
