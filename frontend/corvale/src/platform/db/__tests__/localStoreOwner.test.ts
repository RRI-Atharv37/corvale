import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemorySqliteDriver } from '../MemorySqliteDriver'
import { runMigrations } from '../migrations/runMigrations'
import { MIGRATIONS } from '../migrations/schema'
import type { LocalDb } from '../LocalDb'
import { getStoredOwnerId, setStoredOwnerId } from '../localStoreOwner'
import { seedFromBootstrap } from '../repositories/bootstrapSeed'
import { getCheckpoint } from '../../sync/checkpointStore'
import type { BootstrapSyncSnapshot } from '../../sync/syncApi'

const emptySnapshot: BootstrapSyncSnapshot = {
    checkpoint: '2026-08-31T00:00:00.000Z_cp',
    accounts: [],
    transactions: [],
    categories: [],
    budgets: [],
    savingsGoals: [],
    tags: [],
    recurringRules: [],
    categorizationRules: [],
    savingsGoalContributions: [],
    transactionTemplates: [],
}

describe('localStoreOwner (SEC-38)', () => {
    let db: LocalDb

    beforeEach(async () => {
        db = await MemorySqliteDriver.create()
        await runMigrations(db, MIGRATIONS)
    })

    afterEach(async () => {
        await db.close()
    })

    it('returns null before any owner is recorded', async () => {
        expect(await getStoredOwnerId(db)).toBeNull()
    })

    it('round-trips the owning user id and overwrites on change', async () => {
        await setStoredOwnerId(db, 'user-a')
        expect(await getStoredOwnerId(db)).toBe('user-a')

        await setStoredOwnerId(db, 'user-b')
        expect(await getStoredOwnerId(db)).toBe('user-b')
    })

    it('seedFromBootstrap stamps the owner id alongside the checkpoint', async () => {
        await seedFromBootstrap(db, emptySnapshot, 'user-a')

        expect(await getStoredOwnerId(db)).toBe('user-a')
        expect(await getCheckpoint(db, null)).toBe(emptySnapshot.checkpoint)
    })

    it('seedFromBootstrap records the checkpoint under the scope that was bootstrapped (BUG-55)', async () => {
        await seedFromBootstrap(db, emptySnapshot, 'user-a', 'ws-1')

        expect(await getCheckpoint(db, 'ws-1')).toBe(emptySnapshot.checkpoint)
        expect(await getCheckpoint(db, null)).toBeNull()
    })

    it('seedFromBootstrap leaves the owner unset when no id is passed', async () => {
        await seedFromBootstrap(db, emptySnapshot)
        expect(await getStoredOwnerId(db)).toBeNull()
    })
})
