import type { LocalDb } from './LocalDb'

/**
 * SEC-38: the local store records which account it was seeded for. `provisionLocalDb` compares
 * this to the signed-in user on every online sign-in and wipes-then-reseeds on a mismatch, so a
 * routine session expiry followed by a different user signing in on the same device can never
 * render the previous user's data. Stored as a row in `_sync_meta` alongside the sync checkpoint.
 */
const OWNER_ID_KEY = 'ownerId'

export const getStoredOwnerId = async (db: LocalDb): Promise<string | null> => {
  const rows = await db.select<{ value: string }>('SELECT value FROM _sync_meta WHERE key = ?', [OWNER_ID_KEY])
  return rows[0]?.value ?? null
}

export const setStoredOwnerId = async (db: LocalDb, ownerId: string): Promise<void> => {
  await db.exec(
    `INSERT INTO _sync_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [OWNER_ID_KEY, ownerId]
  )
}
