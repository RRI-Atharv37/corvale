import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { MemorySqliteDriver } from '../../db/MemorySqliteDriver'
import { runMigrations } from '../../db/migrations/runMigrations'
import { MIGRATIONS } from '../../db/migrations/schema'
import { setLocalDb, resetLocalDbForTests } from '../../db/localDbInstance'
import type { LocalDb } from '../../db/LocalDb'

const pushOutboxOps = vi.fn<(...args: unknown[]) => Promise<unknown>>()
const runPullLoop = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})

vi.mock('../syncApi', () => ({
    pushOutboxOps: (...args: unknown[]) => pushOutboxOps(...args),
}))
vi.mock('../pullLoop', () => ({
    runPullLoop: (...args: unknown[]) => runPullLoop(...args),
}))

import { createOutbox } from '../outbox'
import { createSqliteOutboxStore } from '../sqliteOutboxStore'
import {
    getSyncStatus,
    syncNow,
    retrySyncOp,
    discardSyncOp,
    flushOutbox,
    resetLocalData,
    resetSyncEngineForTests,
} from '../syncEngine'
import { putReceiptBlob, getReceiptCacheUsageBytes } from '../../db/receiptBlobCache'
import { createReceiptUploadQueue, createSqliteReceiptUploadStore } from '../receiptUploadQueue'

const setOnline = (online: boolean): void => {
    Object.defineProperty(navigator, 'onLine', { value: online, writable: true, configurable: true })
}

const enqueueOp = async (db: LocalDb, entity: string) => {
    const outbox = createOutbox(createSqliteOutboxStore(db))
    return outbox.enqueue({ entity, operation: 'update', payload: { name: 'x' } })
}

describe('syncEngine - BUG-32 failed-op surfacing', () => {
    let db: LocalDb

    beforeEach(async () => {
        setOnline(true)
        db = await MemorySqliteDriver.create()
        await runMigrations(db, MIGRATIONS)
        setLocalDb(db)
        resetSyncEngineForTests()
        pushOutboxOps.mockReset()
        runPullLoop.mockClear()
    })

    afterEach(async () => {
        resetSyncEngineForTests()
        resetLocalDbForTests()
        await db.close()
        setOnline(true)
    })

    it('reports zero failed ops on a clean queue', async () => {
        const status = await getSyncStatus()
        expect(status.failedCount).toBe(0)
        expect(status.failedOps).toEqual([])
    })

    it('surfaces a server-rejected op as a failedOp carrying the server message', async () => {
        const op = await enqueueOp(db, 'transaction:txn1')
        pushOutboxOps.mockResolvedValue({
            results: [{ opId: op.opId, status: 'rejected', resultId: null, message: 'Account not found' }],
            checkpoint: 'c1',
        })

        await flushOutbox()

        const status = await getSyncStatus()
        expect(status.pendingCount).toBe(1)
        expect(status.conflictCount).toBe(0)
        expect(status.failedCount).toBe(1)
        expect(status.failedOps[0]).toMatchObject({
            opId: op.opId,
            entity: 'transaction:txn1',
            operation: 'update',
            lastError: 'Account not found',
        })
    })

    it('does not bump lastSyncedAt while an op is in the failed state', async () => {
        const op = await enqueueOp(db, 'transaction:txn1')
        pushOutboxOps.mockResolvedValue({
            results: [{ opId: op.opId, status: 'rejected', resultId: null, message: 'nope' }],
            checkpoint: 'c1',
        })

        await syncNow()

        expect(runPullLoop).toHaveBeenCalled()
        const status = await getSyncStatus()
        expect(status.lastSyncedAt).toBeNull()
        expect(status.failedCount).toBe(1)
    })

    it('bumps lastSyncedAt once the queue is clean', async () => {
        pushOutboxOps.mockResolvedValue({ results: [], checkpoint: 'c1' })

        await syncNow()

        const status = await getSyncStatus()
        expect(status.lastSyncedAt).not.toBeNull()
    })

    it('retrySyncOp clears the failure and re-pushes; a now-accepted op leaves the queue', async () => {
        const op = await enqueueOp(db, 'transaction:txn1')
        pushOutboxOps.mockResolvedValueOnce({
            results: [{ opId: op.opId, status: 'rejected', resultId: null, message: 'transient' }],
            checkpoint: 'c1',
        })
        await flushOutbox()
        expect((await getSyncStatus()).failedCount).toBe(1)

        pushOutboxOps.mockResolvedValueOnce({
            results: [{ opId: op.opId, status: 'applied', resultId: 'srv1' }],
            checkpoint: 'c2',
        })
        await retrySyncOp(op.opId)

        const status = await getSyncStatus()
        expect(status.pendingCount).toBe(0)
        expect(status.failedCount).toBe(0)
    })

    it('discardSyncOp permanently drops the stuck op', async () => {
        const op = await enqueueOp(db, 'transaction:txn1')
        pushOutboxOps.mockResolvedValue({
            results: [{ opId: op.opId, status: 'rejected', resultId: null, message: 'nope' }],
            checkpoint: 'c1',
        })
        await flushOutbox()

        await discardSyncOp(op.opId)

        const status = await getSyncStatus()
        expect(status.pendingCount).toBe(0)
        expect(status.failedCount).toBe(0)
    })
})

describe('resetLocalData (SEC-38 / SEC-39: full local wipe)', () => {
    let db: LocalDb

    const countRows = async (table: string): Promise<number> => {
        const rows = await db.select<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)
        return rows[0]?.n ?? 0
    }

    beforeEach(async () => {
        setOnline(true)
        db = await MemorySqliteDriver.create()
        await runMigrations(db, MIGRATIONS)
        setLocalDb(db)
        resetSyncEngineForTests()
    })

    afterEach(async () => {
        resetSyncEngineForTests()
        resetLocalDbForTests()
        await db.close()
    })

    it('clears syncable data, the outbox, conflicts and _sync_meta', async () => {
        await db.exec(
            `INSERT INTO transactions (_id, userId, accountId, categoryId, type, amount, date, data, updatedAt, _localUpdatedAt)
             VALUES ('t1', 'user-a', 'a1', 'c1', 'expense', 100, '2026-08-01', '{}', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`
        )
        await db.exec(`INSERT INTO _sync_meta (key, value) VALUES ('checkpoint', 'cp1'), ('ownerId', 'user-a')`)
        await enqueueOp(db, 'transaction:t1')

        await resetLocalData()

        expect(await countRows('transactions')).toBe(0)
        expect(await countRows('_outbox')).toBe(0)
        expect(await countRows('_conflicts')).toBe(0)
        expect(await countRows('_sync_meta')).toBe(0)
    })

    it('SEC-39: clears the receipt blob cache and the queued-upload table', async () => {
        await putReceiptBlob(db, {
            recordId: 'txn-1',
            mimeType: 'image/png',
            data: new Uint8Array([1, 2, 3, 4, 5]),
        })
        const queue = createReceiptUploadQueue(createSqliteReceiptUploadStore(db))
        await queue.enqueue({
            localBlobId: 'blob-1',
            transactionId: 'txn-1',
            filename: 'receipt.png',
            mimeType: 'image/png',
        })

        expect(await getReceiptCacheUsageBytes(db)).toBeGreaterThan(0)
        expect(await countRows('_receipt_uploads')).toBe(1)

        await resetLocalData()

        expect(await countRows('_blobs')).toBe(0)
        expect(await countRows('_receipt_uploads')).toBe(0)
        expect(await getReceiptCacheUsageBytes(db)).toBe(0)
    })

    it('preserves the applied-migration ledger so the schema is not re-migrated', async () => {
        const before = await db.select<{ version: number }>('SELECT version FROM _schema_version WHERE id = 1')

        await resetLocalData()

        const after = await db.select<{ version: number }>('SELECT version FROM _schema_version WHERE id = 1')
        expect(after[0]?.version).toBe(before[0]?.version)
        expect(after[0]?.version).toBeGreaterThan(0)
    })
})
