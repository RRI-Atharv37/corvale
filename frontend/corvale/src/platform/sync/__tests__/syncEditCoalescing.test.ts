import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MemorySqliteDriver } from '../../db/MemorySqliteDriver'
import { runMigrations } from '../../db/migrations/runMigrations'
import { MIGRATIONS } from '../../db/migrations/schema'
import { setLocalDb, resetLocalDbForTests } from '../../db/localDbInstance'
import { Repository, type SyncableRecord } from '../../db/repositories/Repository'
import type { LocalDb } from '../../db/LocalDb'
import type { OutboxOp } from '../outbox'
import type { PullPage, PushOpsResponse } from '../syncApi'

interface ServerTag extends SyncableRecord {
    userId: string
    name: string
}

const serverDocs = new Map<string, ServerTag>()
let serverClock = 0
const nextServerStamp = (): string => new Date(Date.UTC(2026, 8, 20, 0, 0, ++serverClock)).toISOString()

const CLIENT_T1 = '2026-09-21T10:00:00.000Z'
const CLIENT_T2 = '2026-09-21T10:00:05.000Z'

const fakePush = async (ops: OutboxOp[]): Promise<PushOpsResponse> => {
    const results = ops.map((op) => {
        const id = op.entity.split(':')[1]
        const payload = op.payload as unknown as ServerTag
        if (op.operation === 'create') {
            const updatedAt = nextServerStamp()
            serverDocs.set(id, { ...payload, updatedAt })
            return { opId: op.opId, status: 'applied' as const, resultId: id, updatedAt }
        }
        if (op.operation === 'update') {
            const current = serverDocs.get(id)
            if (!current || op.baseUpdatedAt !== current.updatedAt) {
                return { opId: op.opId, status: 'conflict' as const, resultId: id, conflict: { serverDoc: current ?? {} } }
            }
            const updatedAt = nextServerStamp()
            serverDocs.set(id, { ...payload, updatedAt })
            return { opId: op.opId, status: 'applied' as const, resultId: id, updatedAt }
        }
        serverDocs.delete(id)
        return { opId: op.opId, status: 'applied' as const, resultId: id }
    })
    return { results, checkpoint: 'unused' }
}

const fakePull = async (_workspaceId: unknown, checkpoint: string | null): Promise<PullPage> => {
    const docs = [...serverDocs.values()].filter((doc) => !checkpoint || doc.updatedAt > checkpoint)
    const latest = docs.reduce((max, doc) => (doc.updatedAt > max ? doc.updatedAt : max), checkpoint ?? '0')
    return { changes: docs.map((doc) => ({ entity: 'tag', doc })), tombstones: [], checkpoint: latest, hasMore: false }
}

const pushOutboxOps = vi.fn(fakePush)
const fetchPullPage = vi.fn(fakePull)

vi.mock('../syncApi', () => ({
    pushOutboxOps: (ops: OutboxOp[]) => pushOutboxOps(ops),
    fetchPullPage: (workspaceId: unknown, checkpoint: string | null) => fetchPullPage(workspaceId, checkpoint),
}))

import { getSyncStatus, pullChanges, resetSyncEngineForTests, syncNow } from '../syncEngine'

const tags = new Repository<ServerTag>('tags')

const localRow = async (db: LocalDb, id: string) => {
    const rows = await db.select<{ data: string; updatedAt: string; _dirty: number; _syncState: string }>(
        'SELECT data, updatedAt, _dirty, _syncState FROM tags WHERE _id = ?',
        [id]
    )
    return { ...rows[0], doc: JSON.parse(rows[0].data) as ServerTag }
}

const seedSynced = async (db: LocalDb, id: string): Promise<ServerTag> => {
    const doc: ServerTag = { _id: id, userId: 'u1', name: 'original', updatedAt: nextServerStamp() }
    serverDocs.set(id, doc)
    await db.transaction(async (tx) => tags.upsertFromServer(tx, [doc]))
    return doc
}

const editLocally = (db: LocalDb, doc: ServerTag, name: string, stampedAt: string, baseUpdatedAt: string) =>
    db.transaction(async (tx) => tags.update(tx, { ...doc, name, updatedAt: stampedAt }, baseUpdatedAt))

describe('two unsynced edits of one record (BUG-57)', () => {
    let db: LocalDb

    beforeEach(async () => {
        Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
        db = await MemorySqliteDriver.create()
        await runMigrations(db, MIGRATIONS)
        setLocalDb(db)
        resetSyncEngineForTests()
        serverDocs.clear()
        serverClock = 0
        pushOutboxOps.mockClear()
        fetchPullPage.mockClear()
    })

    afterEach(async () => {
        resetSyncEngineForTests()
        resetLocalDbForTests()
        await db.close()
    })

    it('syncs both edits with no conflict, and the second one is what ends up on the server and on screen', async () => {
        const original = await seedSynced(db, 't1')
        await editLocally(db, original, 'first edit', CLIENT_T1, original.updatedAt)
        await editLocally(db, { ...original, name: 'first edit', updatedAt: CLIENT_T1 }, 'second edit', CLIENT_T2, CLIENT_T1)

        await syncNow()

        const status = await getSyncStatus()
        expect(status.conflictCount).toBe(0)
        expect(status.pendingCount).toBe(0)
        expect(status.failedCount).toBe(0)
        expect(serverDocs.get('t1')?.name).toBe('second edit')

        const local = await localRow(db, 't1')
        expect(local.doc.name).toBe('second edit')
        expect(local.updatedAt).toBe(serverDocs.get('t1')?.updatedAt)
        expect(local._dirty).toBe(0)
        expect(local._syncState).toBe('synced')
    })

    it('handles three queued edits the same way', async () => {
        const original = await seedSynced(db, 't1')
        await editLocally(db, original, 'one', CLIENT_T1, original.updatedAt)
        await editLocally(db, { ...original, name: 'one' }, 'two', CLIENT_T2, CLIENT_T1)
        await editLocally(db, { ...original, name: 'two' }, 'three', '2026-09-21T10:00:09.000Z', CLIENT_T2)

        await syncNow()

        expect((await getSyncStatus()).conflictCount).toBe(0)
        expect(serverDocs.get('t1')?.name).toBe('three')
        expect((await localRow(db, 't1')).doc.name).toBe('three')
    })

    it('a record created and then edited before its first sync does not conflict with its own create', async () => {
        const created: ServerTag = { _id: 't2', userId: 'u1', name: 'draft', updatedAt: CLIENT_T1 }
        await db.transaction(async (tx) => tags.create(tx, created))
        await editLocally(db, created, 'final', CLIENT_T2, CLIENT_T1)

        await syncNow()

        expect((await getSyncStatus()).conflictCount).toBe(0)
        expect((await getSyncStatus()).pendingCount).toBe(0)
        expect(serverDocs.get('t2')?.name).toBe('final')
        const local = await localRow(db, 't2')
        expect(local.doc.name).toBe('final')
        expect(local.updatedAt).toBe(serverDocs.get('t2')?.updatedAt)
    })

    it('a pull that runs while an edit is still queued does not overwrite that edit', async () => {
        const original = await seedSynced(db, 't1')
        await editLocally(db, original, 'my pending edit', CLIENT_T1, original.updatedAt)
        serverDocs.set('t1', { ...original, name: 'edited elsewhere', updatedAt: nextServerStamp() })

        await pullChanges()

        const local = await localRow(db, 't1')
        expect(local.doc.name).toBe('my pending edit')
        expect(local._syncState).toBe('pending')
    })

    it('once the queue is empty a pull overwrites the row with the server copy again', async () => {
        const original = await seedSynced(db, 't1')
        serverDocs.set('t1', { ...original, name: 'edited elsewhere', updatedAt: nextServerStamp() })

        await pullChanges()

        expect((await localRow(db, 't1')).doc.name).toBe('edited elsewhere')
    })
})
