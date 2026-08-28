import type { LocalDb } from './LocalDb'

/**
 * A minimal cached subset of `User` needed for local domain computation
 * (currency conversion today; timezone is read by callers directly since
 * most domain functions already take it as an explicit parameter). Stored
 * as a single JSON blob in the existing `_sync_meta` key/value table rather
 * than a new `users` table, since there's exactly one row and no query
 * needs beyond point lookup. Sprint 13.7 (offline auth/boot) owns the full
 * cached `User` record and its own storage; this can be folded into that
 * once it lands.
 */
export interface LocalUserPrefs {
  preferredCurrency: string
  exchangeRates: Record<string, number>
  timezone: string
}

const SYNC_META_KEY = 'userPrefs'

export const setLocalUserPrefs = async (db: LocalDb, prefs: LocalUserPrefs): Promise<void> => {
  await db.exec(
    `INSERT INTO _sync_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [SYNC_META_KEY, JSON.stringify(prefs)]
  )
}

export const getLocalUserPrefs = async (db: LocalDb): Promise<LocalUserPrefs | null> => {
  const rows = await db.select<{ value: string }>('SELECT value FROM _sync_meta WHERE key = ?', [SYNC_META_KEY])
  return rows[0] ? (JSON.parse(rows[0].value) as LocalUserPrefs) : null
}
