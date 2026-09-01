import type { LocalDb } from '../db/LocalDb'
import { getLocalDb } from '../db/localDbInstance'
import { tableInvalidationBus } from '../db/invalidation/tableInvalidationBus'
import { getStoredActiveWorkspaceId } from '../utils/workspaceScope'
import { pushOutboxOps } from '../utils/syncApi'
import { createOutbox, type Outbox, type OutboxOp, type OutboxOperation, type PushResult } from './outbox'
import { createSqliteOutboxStore } from './sqliteOutboxStore'
import { runPullLoop } from './pullLoop'
import { recordConflict, listUnresolvedConflicts } from './conflicts'
import { parseOutboxEntity, type SyncEntityName } from './entityMap'
import { registerBackgroundSync, startBackgroundSyncBridge } from '../pwa/backgroundSync'

const LAST_SYNCED_KEY = 'lastSyncedAt'

const SYNCABLE_TABLES = [
    'accounts',
    'transactions',
    'categories',
    'budgets',
    'savingsGoals',
    'tags',
    'recurringRules',
    'categorizationRules',
    'savingsGoalContributions',
    'transactionTemplates',
] as const

let outboxInstance: Outbox | null = null

const getOutbox = async (): Promise<Outbox> => {
    if (!outboxInstance) {
        const db = await getLocalDb()
        outboxInstance = createOutbox(createSqliteOutboxStore(db), {
            onEnqueued: () => void registerBackgroundSync(),
        })
    }
    return outboxInstance
}

/** Test-only: forces the next `getOutbox()`/engine call to rebuild against the current `getLocalDb()`. */
export const resetSyncEngineForTests = (): void => {
    outboxInstance = null
}

/**
 * Wraps the real `/sync/push` call as the `Outbox`'s `pushFn`: server `noop` (idempotent replay,
 * already applied) collapses to `applied` for the outbox's purposes, and any `conflict` result is
 * recorded into the `_conflicts` inbox before being reported back so `Outbox.flush` drops it from
 * the pending queue (see `sync/outbox.ts` module doc).
 */
const buildPushFn = (db: LocalDb) => async (ops: OutboxOp[]): Promise<PushResult[]> => {
    const response = await pushOutboxOps(ops, getStoredActiveWorkspaceId())

    for (const result of response.results) {
        if (result.status !== 'conflict' || !result.conflict) continue
        const op = ops.find((candidate) => candidate.opId === result.opId)
        if (!op) continue
        const { entityType, recordId } = parseOutboxEntity(op.entity)
        await recordConflict(db, {
            entity: entityType as SyncEntityName,
            recordId,
            localData: op.payload,
            serverData: result.conflict.serverDoc as never,
        })
    }

    return response.results.map((result) => ({
        opId: result.opId,
        status: result.status === 'noop' ? 'applied' : result.status,
        message: result.message,
    }))
}

export const flushOutbox = async (): Promise<void> => {
    const db = await getLocalDb()
    const outbox = await getOutbox()
    await outbox.flush(buildPushFn(db))
}

export const pullChanges = async (): Promise<void> => {
    const db = await getLocalDb()
    await runPullLoop(db, getStoredActiveWorkspaceId())
}

const markSynced = async (db: LocalDb): Promise<void> => {
    await db.exec(
        `INSERT INTO _sync_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [LAST_SYNCED_KEY, new Date().toISOString()]
    )
}

/**
 * Manual "Sync now": flush local changes first, then pull, so this device's own writes aren't
 * immediately overwritten by a stale pull. `markSynced` is skipped while any op is in the failed
 * state (BUG-32) - bumping "Last synced just now" over an undelivered change reassures the user
 * that everything is fine when it isn't.
 */
export const syncNow = async (): Promise<void> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return
    }
    await flushOutbox()
    await pullChanges()
    const db = await getLocalDb()
    const outbox = await getOutbox()
    const hasFailedOps = (await outbox.listPending()).some((op) => op.lastError !== null)
    if (!hasFailedOps) {
        await markSynced(db)
    }
}

/** One outbox op the server rejected (BUG-32): still pending, but stuck until the user retries or discards it. */
export interface FailedSyncOp {
    opId: string
    entity: string
    operation: OutboxOperation
    lastError: string
    attempts: number
}

export interface SyncStatus {
    online: boolean
    pendingCount: number
    conflictCount: number
    /** Count of `failedOps` - a permanently-rejected op is not a conflict, so it needs its own signal. */
    failedCount: number
    failedOps: FailedSyncOp[]
    lastSyncedAt: string | null
}

/** Retry a single rejected op now (clears its backoff), then flush. */
export const retrySyncOp = async (opId: string): Promise<void> => {
    const outbox = await getOutbox()
    await outbox.retry(opId)
    await flushOutbox()
}

/** Permanently drop a single rejected op. The change is not sent to the server and cannot be recovered. */
export const discardSyncOp = async (opId: string): Promise<void> => {
    const outbox = await getOutbox()
    await outbox.discard(opId)
    tableInvalidationBus.publish('_outbox')
}

export const getSyncStatus = async (): Promise<SyncStatus> => {
    const db = await getLocalDb()
    const outbox = await getOutbox()
    const [pending, conflicts, lastSyncedRows] = await Promise.all([
        outbox.listPending(),
        listUnresolvedConflicts(db),
        db.select<{ value: string }>('SELECT value FROM _sync_meta WHERE key = ?', [LAST_SYNCED_KEY]),
    ])

    const failedOps: FailedSyncOp[] = pending
        .filter((op) => op.lastError !== null)
        .map((op) => ({
            opId: op.opId,
            entity: op.entity,
            operation: op.operation,
            lastError: op.lastError as string,
            attempts: op.attempts,
        }))

    return {
        online: typeof navigator === 'undefined' || navigator.onLine,
        pendingCount: pending.length,
        conflictCount: conflicts.length,
        failedCount: failedOps.length,
        failedOps,
        lastSyncedAt: lastSyncedRows[0]?.value ?? null,
    }
}

/** The one table `resetLocalData` must never clear - the applied-migration marker (`runMigrations.ts`). */
const MIGRATION_LEDGER_TABLE = '_schema_version'

/**
 * Wipes every local table except the migration ledger - syncable data, outbox, conflicts,
 * checkpoint/owner (`_sync_meta`), and the receipt blob cache + upload queue (`_blobs`,
 * `_receipt_uploads`). SEC-39: those last two were previously left behind, so one user's receipt
 * images stayed cached and their queued uploads drained under the next user's token. Enumerating
 * `sqlite_master` rather than a hand-maintained list means a table added in a future migration is
 * cleared by default rather than missed by default. Auth/session state (outside SQLite) is
 * untouched - `wipeLocalData` handles that.
 */
export const resetLocalData = async (): Promise<void> => {
    const db = await getLocalDb()
    const tables = await db.select<{ name: string }>(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != ?`,
        [MIGRATION_LEDGER_TABLE]
    )
    await db.transaction(async (tx) => {
        for (const { name } of tables) {
            await tx.exec(`DELETE FROM ${name}`)
        }
    })
    outboxInstance = null

    for (const table of SYNCABLE_TABLES) {
        tableInvalidationBus.publish(table)
    }
    tableInvalidationBus.publish('_conflicts')
    tableInvalidationBus.publish('_receipt_uploads')
}

let listenersAttached = false

/**
 * Starts the online/offline-driven sync loop. Only called when `VITE_LOCAL_FIRST` is on (see
 * `utils/localFirstFlag.ts`). Also starts the Background Sync bridge (Sprint 13.8): the `online`
 * listener alone only fires while this tab is open, so `startBackgroundSyncBridge` adds the
 * service-worker wake-up channel plus a foreground polling fallback for browsers/situations where
 * Background Sync can't run (see `pwa/backgroundSync.ts`).
 */
export const startSyncEngine = (): (() => void) => {
    if (listenersAttached || typeof window === 'undefined') {
        return () => {}
    }
    listenersAttached = true

    const handleOnline = () => {
        void syncNow()
    }
    window.addEventListener('online', handleOnline)
    const stopBackgroundSyncBridge = startBackgroundSyncBridge(syncNow)

    return () => {
        window.removeEventListener('online', handleOnline)
        stopBackgroundSyncBridge()
        listenersAttached = false
    }
}
