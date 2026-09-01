import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemorySqliteDriver } from '../MemorySqliteDriver'
import { runMigrations } from '../migrations/runMigrations'
import { MIGRATIONS } from '../migrations/schema'
import type { LocalDb } from '../LocalDb'
import { getStoredOwnerId, setStoredOwnerId } from '../localStoreOwner'
import { seedFromBootstrap } from '../repositories/bootstrapSeed'
import type { BootstrapSyncSnapshot } from '../../utils/syncApi'

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
        const cp = await db.select<{ value: string }>("SELECT value FROM _sync_meta WHERE key = 'checkpoint'")
        expect(cp[0]?.value).toBe(emptySnapshot.checkpoint)
    })

    it('seedFromBootstrap leaves the owner unset when no id is passed', async () => {
        await seedFromBootstrap(db, emptySnapshot)
        expect(await getStoredOwnerId(db)).toBeNull()
    })
})
