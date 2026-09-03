import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalDb } from '../LocalDb'
import type { BootstrapSyncSnapshot } from '../../sync/syncApi'

vi.mock('@lib/localFirstFlag', () => ({ isLocalFirstEnabled: vi.fn() }))
vi.mock('@lib/workspaceScope', () => ({ getStoredActiveWorkspaceId: vi.fn() }))

const fetchBootstrapSnapshotMock = vi.fn()
vi.mock('../../sync/syncApi', () => ({ fetchBootstrapSnapshot: (...args: unknown[]) => fetchBootstrapSnapshotMock(...args) }))

const seedFromBootstrapMock = vi.fn()
vi.mock('../repositories/bootstrapSeed', () => ({ seedFromBootstrap: (...args: unknown[]) => seedFromBootstrapMock(...args) }))

const getCheckpointMock = vi.fn()
vi.mock('../../sync/pullLoop', () => ({ getCheckpoint: (...args: unknown[]) => getCheckpointMock(...args) }))

const resetLocalDataMock = vi.fn()
vi.mock('../../sync/syncEngine', () => ({ resetLocalData: (...args: unknown[]) => resetLocalDataMock(...args) }))

const getStoredOwnerIdMock = vi.fn()
vi.mock('../localStoreOwner', () => ({ getStoredOwnerId: (...args: unknown[]) => getStoredOwnerIdMock(...args) }))

const { isLocalFirstEnabled } = await import('@lib/localFirstFlag')
const { getStoredActiveWorkspaceId } = await import('@lib/workspaceScope')
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
        resetLocalDataMock.mockReset().mockResolvedValue(undefined)
        getStoredOwnerIdMock.mockReset().mockResolvedValue(null)
        vi.mocked(fakeDb.select).mockReset().mockResolvedValue([{ total: 12 }])
    })

    it('does nothing when local-first is disabled', async () => {
        vi.mocked(isLocalFirstEnabled).mockReturnValue(false)

        await provisionLocalDb('user-a')

        expect(fetchBootstrapSnapshotMock).not.toHaveBeenCalled()
        expect(seedFromBootstrapMock).not.toHaveBeenCalled()
    })

    it('seeds the local store and records the owning user id on a fresh device (no checkpoint yet)', async () => {
        await provisionLocalDb('user-a')

        expect(fetchBootstrapSnapshotMock).toHaveBeenCalledWith(null)
        expect(seedFromBootstrapMock).toHaveBeenCalledWith(await getLocalDb(), snapshot, 'user-a')
        expect(resetLocalDataMock).not.toHaveBeenCalled()
    })

    it('scopes the bootstrap fetch to the active workspace when one is set', async () => {
        vi.mocked(getStoredActiveWorkspaceId).mockReturnValue('workspace-1')

        await provisionLocalDb('user-a')

        expect(fetchBootstrapSnapshotMock).toHaveBeenCalledWith('workspace-1')
    })

    it('is a no-op when the store already belongs to the user signing in', async () => {
        getCheckpointMock.mockResolvedValue('2026-08-24T00:00:00.000Z_prev')
        vi.mocked(fakeDb.select).mockResolvedValue([{ total: 12 }])
        getStoredOwnerIdMock.mockResolvedValue('user-a')

        await provisionLocalDb('user-a')

        expect(resetLocalDataMock).not.toHaveBeenCalled()
        expect(fetchBootstrapSnapshotMock).not.toHaveBeenCalled()
        expect(seedFromBootstrapMock).not.toHaveBeenCalled()
    })

    it('SEC-38: wipes and reseeds when the provisioned store belongs to a different account', async () => {
        getCheckpointMock.mockResolvedValue('2026-08-24T00:00:00.000Z_prev')
        vi.mocked(fakeDb.select).mockResolvedValue([{ total: 12 }])
        getStoredOwnerIdMock.mockResolvedValue('user-b')

        await provisionLocalDb('user-a')

        expect(resetLocalDataMock).toHaveBeenCalledTimes(1)
        expect(fetchBootstrapSnapshotMock).toHaveBeenCalledWith(null)
        expect(seedFromBootstrapMock).toHaveBeenCalledWith(await getLocalDb(), snapshot, 'user-a')
    })

    it('SEC-38: wipes and reseeds a provisioned store that has no recorded owner (seeded before the fix)', async () => {
        getCheckpointMock.mockResolvedValue('2026-08-24T00:00:00.000Z_prev')
        vi.mocked(fakeDb.select).mockResolvedValue([{ total: 12 }])
        getStoredOwnerIdMock.mockResolvedValue(null)

        await provisionLocalDb('user-a')

        expect(resetLocalDataMock).toHaveBeenCalledTimes(1)
        expect(seedFromBootstrapMock).toHaveBeenCalledWith(await getLocalDb(), snapshot, 'user-a')
    })

    it('re-seeds when a checkpoint exists but the store is empty (BUG-30: rebuilt / half-seeded store)', async () => {
        getCheckpointMock.mockResolvedValue('2026-08-24T00:00:00.000Z_prev')
        vi.mocked(fakeDb.select).mockResolvedValue([{ total: 0 }])

        await provisionLocalDb('user-a')

        expect(resetLocalDataMock).not.toHaveBeenCalled()
        expect(fetchBootstrapSnapshotMock).toHaveBeenCalledWith(null)
        expect(seedFromBootstrapMock).toHaveBeenCalledWith(await getLocalDb(), snapshot, 'user-a')
    })

    it('swallows a bootstrap fetch failure instead of throwing out of the login flow', async () => {
        fetchBootstrapSnapshotMock.mockRejectedValue(new Error('network unreachable'))

        await expect(provisionLocalDb('user-a')).resolves.toBeUndefined()
        expect(seedFromBootstrapMock).not.toHaveBeenCalled()
    })

    it('swallows a seeding failure instead of throwing out of the login flow', async () => {
        seedFromBootstrapMock.mockRejectedValue(new Error('transaction failed'))

        await expect(provisionLocalDb('user-a')).resolves.toBeUndefined()
    })
})
