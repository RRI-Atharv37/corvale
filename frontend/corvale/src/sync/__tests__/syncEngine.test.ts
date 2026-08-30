import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { MemorySqliteDriver } from '../../db/MemorySqliteDriver'
import { runMigrations } from '../../db/migrations/runMigrations'
import { MIGRATIONS } from '../../db/migrations/schema'
import { setLocalDb, resetLocalDbForTests } from '../../db/localDbInstance'
import type { LocalDb } from '../../db/LocalDb'

const pushOutboxOps = vi.fn<(...args: unknown[]) => Promise<unknown>>()
const runPullLoop = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})

vi.mock('../../utils/syncApi', () => ({
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
    resetSyncEngineForTests,
} from '../syncEngine'

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
