import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MemorySqliteDriver } from '../../db/MemorySqliteDriver'
import { runMigrations } from '../../db/migrations/runMigrations'
import { MIGRATIONS } from '../../db/migrations/schema'
import type { LocalDb } from '../../db/LocalDb'
import { setCheckpoint } from '../checkpointStore'
import { purgeWorkspacesNotIn } from '../workspaceOffboarding'

const NOW = '2026-09-01T00:00:00.000Z'
const META = [NOW, NOW, 0, 'synced'] as const

const seed = {
    account: (db: LocalDb, id: string, workspaceId: string | null) =>
        db.exec(
            `INSERT INTO accounts (_id, userId, workspaceId, name, type, currency, data, updatedAt, _localUpdatedAt, _dirty, _syncState)
             VALUES (?, 'u1', ?, 'Acct', 'checking', 'USD', '{}', ?, ?, ?, ?)`,
            [id, workspaceId, ...META]
        ),
    transaction: (db: LocalDb, id: string, workspaceId: string | null) =>
        db.exec(
            `INSERT INTO transactions (_id, userId, workspaceId, accountId, categoryId, type, amount, date, data, updatedAt, _localUpdatedAt, _dirty, _syncState)
             VALUES (?, 'u1', ?, 'a', 'c', 'expense', 100, ?, '{}', ?, ?, ?, ?)`,
            [id, workspaceId, NOW, ...META]
        ),
    budget: (db: LocalDb, id: string, workspaceId: string | null) =>
        db.exec(
            `INSERT INTO budgets (_id, userId, workspaceId, periodStart, periodEnd, data, updatedAt, _localUpdatedAt, _dirty, _syncState)
             VALUES (?, 'u1', ?, ?, ?, '{}', ?, ?, ?, ?)`,
            [id, workspaceId, NOW, NOW, ...META]
        ),
    goal: (db: LocalDb, id: string, workspaceId: string | null) =>
        db.exec(
            `INSERT INTO savingsGoals (_id, userId, workspaceId, data, updatedAt, _localUpdatedAt, _dirty, _syncState)
             VALUES (?, 'u1', ?, '{}', ?, ?, ?, ?)`,
            [id, workspaceId, ...META]
        ),
    contribution: (db: LocalDb, id: string, goalId: string) =>
        db.exec(
            `INSERT INTO savingsGoalContributions (_id, userId, goalId, amount, contributedAt, data, updatedAt, _localUpdatedAt, _dirty, _syncState)
             VALUES (?, 'u1', ?, 5, ?, '{}', ?, ?, ?, ?)`,
            [id, goalId, NOW, ...META]
        ),
    recurring: (db: LocalDb, id: string, workspaceId: string | null) =>
        db.exec(
            `INSERT INTO recurringRules (_id, userId, workspaceId, accountId, categoryId, nextDueDate, data, updatedAt, _localUpdatedAt, _dirty, _syncState)
             VALUES (?, 'u1', ?, 'a', 'c', ?, '{}', ?, ?, ?, ?)`,
            [id, workspaceId, NOW, ...META]
        ),
    outbox: (db: LocalDb, opId: string, entity: string) =>
        db.exec(
            `INSERT INTO _outbox (opId, entity, operation, payload, createdAt, attempts) VALUES (?, ?, 'update', '{}', ?, 0)`,
            [opId, entity, NOW]
        ),
    conflict: (db: LocalDb, id: string, entity: string, recordId: string) =>
        db.exec(
            `INSERT INTO _conflicts (id, entity, recordId, localData, serverData, detectedAt) VALUES (?, ?, ?, '{}', '{}', ?)`,
            [id, entity, recordId, NOW]
        ),
    receipt: async (db: LocalDb, blobId: string, transactionId: string) => {
        await db.exec(
            `INSERT INTO _blobs (id, entity, recordId, sizeBytes, createdAt, lastAccessedAt) VALUES (?, 'receipt', ?, 1, ?, ?)`,
            [blobId, transactionId, NOW, NOW]
        )
        await db.exec(
            `INSERT INTO _receipt_uploads (id, localBlobId, transactionId, filename, mimeType, createdAt) VALUES (?, ?, ?, 'r.pdf', 'application/pdf', ?)`,
            [`up-${blobId}`, blobId, transactionId, NOW]
        )
    },
}

const ids = async (db: LocalDb, table: string, column = '_id'): Promise<string[]> =>
    (await db.select<Record<string, string>>(`SELECT ${column} AS v FROM ${table} ORDER BY ${column}`)).map((row) => row.v)

describe('a member who leaves or is removed keeps no workspace rows on the device (SEC-82)', () => {
    let db: LocalDb

    beforeEach(async () => {
        db = await MemorySqliteDriver.create()
        await runMigrations(db, MIGRATIONS)

        await seed.account(db, 'a-personal', null)
        await seed.transaction(db, 't-personal', null)
        await seed.account(db, 'a-gone', 'ws-gone')
        await seed.transaction(db, 't-gone', 'ws-gone')
        await seed.budget(db, 'b-gone', 'ws-gone')
        await seed.goal(db, 'g-gone', 'ws-gone')
        await seed.contribution(db, 'c-gone', 'g-gone')
        await seed.recurring(db, 'r-gone', 'ws-gone')
        await seed.account(db, 'a-kept', 'ws-kept')
        await seed.transaction(db, 't-kept', 'ws-kept')
        await seed.goal(db, 'g-personal', null)
        await seed.contribution(db, 'c-personal', 'g-personal')

        await seed.outbox(db, 'op-gone', 'transaction:t-gone')
        await seed.outbox(db, 'op-kept', 'transaction:t-kept')
        await seed.outbox(db, 'op-personal', 'transaction:t-personal')
        await seed.outbox(db, 'op-contribution', 'savingsGoalContribution:c-gone')
        await seed.conflict(db, 'k-gone', 'transaction', 't-gone')
        await seed.conflict(db, 'k-kept', 'transaction', 't-kept')
        await seed.receipt(db, 'blob-gone', 't-gone')
        await seed.receipt(db, 'blob-kept', 't-kept')

        await setCheckpoint(db, null, 'cp-personal')
        await setCheckpoint(db, 'ws-gone', 'cp-gone')
        await setCheckpoint(db, 'ws-kept', 'cp-kept')
    })

    afterEach(async () => {
        await db.close()
    })

    it('drops the rows of every workspace the user is no longer in, and keeps personal and current ones', async () => {
        await purgeWorkspacesNotIn(db, ['ws-kept'])

        expect(await ids(db, 'accounts')).toEqual(['a-kept', 'a-personal'])
        expect(await ids(db, 'transactions')).toEqual(['t-kept', 't-personal'])
        expect(await ids(db, 'budgets')).toEqual([])
        expect(await ids(db, 'savingsGoals')).toEqual(['g-personal'])
        expect(await ids(db, 'recurringRules')).toEqual([])
    })

    it("drops contributions to a removed workspace's goals but not personal ones", async () => {
        await purgeWorkspacesNotIn(db, ['ws-kept'])

        expect(await ids(db, 'savingsGoalContributions')).toEqual(['c-personal'])
    })

    it('drops queued ops, conflicts, cached receipts and queued receipt uploads for the purged records only', async () => {
        await purgeWorkspacesNotIn(db, ['ws-kept'])

        expect(await ids(db, '_outbox', 'opId')).toEqual(['op-kept', 'op-personal'])
        expect(await ids(db, '_conflicts', 'id')).toEqual(['k-kept'])
        expect(await ids(db, '_blobs', 'id')).toEqual(['blob-kept'])
        expect(await ids(db, '_receipt_uploads', 'id')).toEqual(['up-blob-kept'])
    })

    it("forgets the removed workspace's pull checkpoint so a later re-invite starts from the beginning", async () => {
        await purgeWorkspacesNotIn(db, ['ws-kept'])

        expect(await ids(db, '_sync_meta', 'key')).toEqual(['checkpoint:personal', 'checkpoint:ws:ws-kept'])
    })

    it('with no memberships left, removes every workspace row and keeps personal data', async () => {
        await purgeWorkspacesNotIn(db, [])

        expect(await ids(db, 'accounts')).toEqual(['a-personal'])
        expect(await ids(db, 'transactions')).toEqual(['t-personal'])
        expect(await ids(db, '_sync_meta', 'key')).toEqual(['checkpoint:personal'])
    })

    it('reports the tables it changed, and nothing when there is nothing to drop', async () => {
        const first = await purgeWorkspacesNotIn(db, ['ws-kept', 'ws-gone'])
        expect(first).toEqual([])

        const second = await purgeWorkspacesNotIn(db, ['ws-kept'])
        expect(second.sort()).toEqual(
            ['accounts', 'budgets', 'recurringRules', 'savingsGoalContributions', 'savingsGoals', 'transactions'].sort()
        )

        expect(await purgeWorkspacesNotIn(db, ['ws-kept'])).toEqual([])
    })

    it('removes large workspaces without hitting the SQL variable limit', async () => {
        for (let i = 0; i < 1100; i += 1) {
            await seed.transaction(db, `bulk-${i}`, 'ws-gone')
        }

        await purgeWorkspacesNotIn(db, ['ws-kept'])

        expect(await ids(db, 'transactions')).toEqual(['t-kept', 't-personal'])
    })
})
