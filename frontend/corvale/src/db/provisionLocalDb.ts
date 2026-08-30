import type { LocalDb } from './LocalDb'
import { getLocalDb } from './localDbInstance'
import { getCheckpoint } from '../sync/pullLoop'
import { fetchBootstrapSnapshot } from '../utils/syncApi'
import { seedFromBootstrap } from './repositories/bootstrapSeed'
import { isLocalFirstEnabled } from '../utils/localFirstFlag'
import { getStoredActiveWorkspaceId } from '../utils/workspaceScope'

/**
 * True when the store holds no rows in any core synced table. BUG-30: a store that was rebuilt
 * from scratch (or half-seeded then interrupted) can end up with a checkpoint row but no data -
 * `getCheckpoint() !== null` alone would then wrongly treat it as provisioned and leave every
 * page empty until the incremental pull loop slowly backfills. Checking for actual rows catches
 * the present-but-empty case too.
 */
const localStoreIsEmpty = async (db: LocalDb): Promise<boolean> => {
  const rows = await db.select<{ total: number }>(
    `SELECT (SELECT count(*) FROM accounts)
          + (SELECT count(*) FROM transactions)
          + (SELECT count(*) FROM categories) AS total`
  )
  return (rows[0]?.total ?? 0) === 0
}

/**
 * Runs once per device, right after a successful online sign-in (Login/Signup) when local-first
 * is on: seeds every syncable table from a single `/sync/bootstrap` snapshot so the device holds
 * a complete local copy of the user's data before it is ever asked to go offline (D5 - "sign in
 * once, then offline forever"). A no-op once a checkpoint exists *and* the store actually holds
 * data - either this already ran, or `DashboardLayout`'s incremental pull loop has been populating
 * the store on its own - so signing in again on an already-provisioned device costs one cheap
 * `SELECT`.
 *
 * Failures are swallowed: the incremental pull loop `DashboardLayout` starts on every mount is a
 * strictly slower fallback that reaches the same end state, so a failed one-shot bootstrap (e.g. a
 * flaky connection right after sign-in) degrades to the pre-D5 behavior instead of blocking login.
 */
export const provisionLocalDb = async (): Promise<void> => {
    if (!isLocalFirstEnabled()) return

    try {
        const db = await getLocalDb()
        const checkpoint = await getCheckpoint(db)
        if (checkpoint !== null && !(await localStoreIsEmpty(db))) return

        const snapshot = await fetchBootstrapSnapshot(getStoredActiveWorkspaceId())
        await seedFromBootstrap(db, snapshot)
    } catch (error) {
        console.error('Local DB provisioning failed; falling back to incremental sync', error)
    }
}
