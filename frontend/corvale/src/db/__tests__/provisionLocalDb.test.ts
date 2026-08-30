import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalDb } from '../LocalDb'
import type { BootstrapSyncSnapshot } from '../../utils/syncApi'

vi.mock('../../utils/localFirstFlag', () => ({ isLocalFirstEnabled: vi.fn() }))
vi.mock('../../utils/workspaceScope', () => ({ getStoredActiveWorkspaceId: vi.fn() }))

const fetchBootstrapSnapshotMock = vi.fn()
vi.mock('../../utils/syncApi', () => ({ fetchBootstrapSnapshot: (...args: unknown[]) => fetchBootstrapSnapshotMock(...args) }))

const seedFromBootstrapMock = vi.fn()
vi.mock('../repositories/bootstrapSeed', () => ({ seedFromBootstrap: (...args: unknown[]) => seedFromBootstrapMock(...args) }))

const getCheckpointMock = vi.fn()
vi.mock('../../sync/pullLoop', () => ({ getCheckpoint: (...args: unknown[]) => getCheckpointMock(...args) }))

const { isLocalFirstEnabled } = await import('../../utils/localFirstFlag')
const { getStoredActiveWorkspaceId } = await import('../../utils/workspaceScope')
const { provisionLocalDb } = await import('../provisionLocalDb')
const { getLocalDb, resetLocalDbForTests, setLocalDb } = await import('../localDbInstance')

const fakeDb: LocalDb = {
    exec: vi.fn().mockResolvedValue(undefined),
    // Default: the store holds data (localStoreIsEmpty -> false). Tests that need a
    // present-but-empty store override this.
    select: vi.fn().mockResolvedValue([{ total: 12 }]),
    transaction: vi.fn(async (fn) => fn(fakeDb)),
    close: vi.fn(),
}

const snapshot: BootstrapSyncSnapshot = {
    checkpoint: '2026-08-25T00:00:00.000Z_abc123',
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

describe('provisionLocalDb (D5 - sign in once, then offline forever)', () => {
    beforeEach(() => {
        resetLocalDbForTests()
        setLocalDb(fakeDb)
        vi.mocked(isLocalFirstEnabled).mockReset().mockReturnValue(true)
        vi.mocked(getStoredActiveWorkspaceId).mockReset().mockReturnValue(null)
        getCheckpointMock.mockReset().mockResolvedValue(null)
        fetchBootstrapSnapshotMock.mockReset().mockResolvedValue(snapshot)
        seedFromBootstrapMock.mockReset().mockResolvedValue(undefined)
        vi.mocked(fakeDb.select).mockReset().mockResolvedValue([{ total: 12 }])
    })

    it('does nothing when local-first is disabled', async () => {
        vi.mocked(isLocalFirstEnabled).mockReturnValue(false)

        await provisionLocalDb()

        expect(fetchBootstrapSnapshotMock).not.toHaveBeenCalled()
        expect(seedFromBootstrapMock).not.toHaveBeenCalled()
    })

    it('seeds the local store from a bootstrap snapshot on a fresh device (no checkpoint yet)', async () => {
        await provisionLocalDb()

        expect(fetchBootstrapSnapshotMock).toHaveBeenCalledWith(null)
        expect(seedFromBootstrapMock).toHaveBeenCalledWith(await getLocalDb(), snapshot)
    })

    it('scopes the bootstrap fetch to the active workspace when one is set', async () => {
        vi.mocked(getStoredActiveWorkspaceId).mockReturnValue('workspace-1')

        await provisionLocalDb()

        expect(fetchBootstrapSnapshotMock).toHaveBeenCalledWith('workspace-1')
    })

    it('is a no-op once a checkpoint exists and the store holds data - already provisioned, or the pull loop has run', async () => {
        getCheckpointMock.mockResolvedValue('2026-08-24T00:00:00.000Z_prev')
        vi.mocked(fakeDb.select).mockResolvedValue([{ total: 12 }])

        await provisionLocalDb()

        expect(fetchBootstrapSnapshotMock).not.toHaveBeenCalled()
        expect(seedFromBootstrapMock).not.toHaveBeenCalled()
    })

    it('re-seeds when a checkpoint exists but the store is empty (BUG-30: rebuilt / half-seeded store)', async () => {
        getCheckpointMock.mockResolvedValue('2026-08-24T00:00:00.000Z_prev')
        vi.mocked(fakeDb.select).mockResolvedValue([{ total: 0 }])

        await provisionLocalDb()

        expect(fetchBootstrapSnapshotMock).toHaveBeenCalledWith(null)
        expect(seedFromBootstrapMock).toHaveBeenCalledWith(await getLocalDb(), snapshot)
    })

    it('swallows a bootstrap fetch failure instead of throwing out of the login flow', async () => {
        fetchBootstrapSnapshotMock.mockRejectedValue(new Error('network unreachable'))

        await expect(provisionLocalDb()).resolves.toBeUndefined()
        expect(seedFromBootstrapMock).not.toHaveBeenCalled()
    })

    it('swallows a seeding failure instead of throwing out of the login flow', async () => {
        seedFromBootstrapMock.mockRejectedValue(new Error('transaction failed'))

        await expect(provisionLocalDb()).resolves.toBeUndefined()
    })
})
