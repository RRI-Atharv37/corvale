import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MemorySqliteDriver } from '../../db/MemorySqliteDriver'
import { runMigrations } from '../../db/migrations/runMigrations'
import { MIGRATIONS } from '../../db/migrations/schema'
import type { LocalDb } from '../../db/LocalDb'
import type { SyncableRecord } from '../../db/repositories/Repository'
import type { PullPage } from '../syncApi'

interface ServerTag extends SyncableRecord {
    userId: string
    name: string
}

const serverByScope: Record<string, ServerTag[]> = {}
const fetchPullPage = vi.fn<(workspaceId: string | null | undefined, checkpoint: string | null) => Promise<PullPage>>()

vi.mock('../syncApi', () => ({
    fetchPullPage: (workspaceId: string | null | undefined, checkpoint: string | null) =>
        fetchPullPage(workspaceId, checkpoint),
}))

import { runPullLoop } from '../pullLoop'
import { getCheckpoint, hasAnyCheckpoint } from '../checkpointStore'

const scopeOf = (workspaceId: string | null | undefined): string => workspaceId || 'personal'

const fakeServer = async (workspaceId: string | null | undefined, checkpoint: string | null): Promise<PullPage> => {
    const docs = (serverByScope[scopeOf(workspaceId)] ?? []).filter((doc) => !checkpoint || doc.updatedAt > checkpoint)
    const latest = docs.reduce((max, doc) => (doc.updatedAt > max ? doc.updatedAt : max), checkpoint ?? '0')
    return {
        changes: docs.map((doc) => ({ entity: 'tag', doc })),
        tombstones: [],
        checkpoint: latest,
        hasMore: false,
    }
}

const localTagIds = async (db: LocalDb): Promise<string[]> =>
    (await db.select<{ _id: string }>('SELECT _id FROM tags ORDER BY _id')).map((row) => row._id)

describe('pull checkpoints are kept per scope (BUG-55)', () => {
    let db: LocalDb

    beforeEach(async () => {
        db = await MemorySqliteDriver.create()
        await runMigrations(db, MIGRATIONS)
        fetchPullPage.mockReset().mockImplementation(fakeServer)
        serverByScope.personal = [
            { _id: 'p1', userId: 'u1', name: 'p1', updatedAt: '2026-09-01T00:00:00.000Z' },
            { _id: 'p2', userId: 'u1', name: 'p2', updatedAt: '2026-09-03T00:00:00.000Z' },
        ]
        serverByScope['ws-1'] = [
            { _id: 'w1', userId: 'u1', name: 'w1', updatedAt: '2026-08-31T00:00:00.000Z' },
            { _id: 'w2', userId: 'u1', name: 'w2', updatedAt: '2026-09-02T00:00:00.000Z' },
        ]
    })

    afterEach(async () => {
        await db.close()
    })

    it('switching personal -> workspace -> personal delivers every record of each scope', async () => {
        await runPullLoop(db, null)
        expect(await localTagIds(db)).toEqual(['p1', 'p2'])

        await runPullLoop(db, 'ws-1')
        expect(await localTagIds(db)).toEqual(['p1', 'p2', 'w1', 'w2'])

        serverByScope.personal.push({ _id: 'p3', userId: 'u1', name: 'p3', updatedAt: '2026-09-04T00:00:00.000Z' })
        serverByScope['ws-1'].push({ _id: 'w3', userId: 'u1', name: 'w3', updatedAt: '2026-09-05T00:00:00.000Z' })

        await runPullLoop(db, null)
        expect(await localTagIds(db)).toEqual(['p1', 'p2', 'p3', 'w1', 'w2'])

        await runPullLoop(db, 'ws-1')
        expect(await localTagIds(db)).toEqual(['p1', 'p2', 'p3', 'w1', 'w2', 'w3'])
    })

    it('a scope pulled for the first time starts from the beginning, not from another scope\'s cursor', async () => {
        await runPullLoop(db, null)
        fetchPullPage.mockClear()

        await runPullLoop(db, 'ws-1')

        expect(fetchPullPage).toHaveBeenCalledWith('ws-1', null)
    })

    it('switching back resumes from that scope\'s own checkpoint', async () => {
        await runPullLoop(db, null)
        await runPullLoop(db, 'ws-1')
        fetchPullPage.mockClear()

        await runPullLoop(db, null)

        expect(fetchPullPage).toHaveBeenCalledWith(null, '2026-09-03T00:00:00.000Z')
        expect(await getCheckpoint(db, null)).toBe('2026-09-03T00:00:00.000Z')
        expect(await getCheckpoint(db, 'ws-1')).toBe('2026-09-02T00:00:00.000Z')
    })

    it('treats an empty or undefined workspace id as the personal scope', async () => {
        await runPullLoop(db, undefined)
        expect(await getCheckpoint(db, null)).toBe('2026-09-03T00:00:00.000Z')
        expect(await getCheckpoint(db, '')).toBe('2026-09-03T00:00:00.000Z')
    })

    it('discards the legacy single checkpoint (its scope is unknown) and pulls from the beginning', async () => {
        await db.exec(`INSERT INTO _sync_meta (key, value) VALUES ('checkpoint', '2026-09-30T00:00:00.000Z')`)
        expect(await hasAnyCheckpoint(db)).toBe(true)

        await runPullLoop(db, null)

        expect(fetchPullPage).toHaveBeenCalledWith(null, null)
        expect(await localTagIds(db)).toEqual(['p1', 'p2'])
        const legacy = await db.select("SELECT value FROM _sync_meta WHERE key = 'checkpoint'")
        expect(legacy).toHaveLength(0)
        expect(await hasAnyCheckpoint(db)).toBe(true)
    })

    it('reports no checkpoint on a store that has never pulled', async () => {
        expect(await hasAnyCheckpoint(db)).toBe(false)
        expect(await getCheckpoint(db, null)).toBeNull()
    })
})
