import { describe, it, expect, vi, beforeEach } from 'vitest'

import { countUnsyncedChanges, syncBeforeSignOut } from '../signOutFlow'

const { getSyncStatusMock, syncNowMock, isLocalFirstEnabledMock } = vi.hoisted(() => ({
    getSyncStatusMock: vi.fn(),
    syncNowMock: vi.fn(),
    isLocalFirstEnabledMock: vi.fn(),
}))

vi.mock('../../sync/syncEngine', () => ({
    getSyncStatus: getSyncStatusMock,
    syncNow: syncNowMock,
}))
vi.mock('@lib/localFirstFlag', () => ({
    isLocalFirstEnabled: isLocalFirstEnabledMock,
}))

beforeEach(() => {
    vi.clearAllMocks()
    isLocalFirstEnabledMock.mockReturnValue(true)
    getSyncStatusMock.mockResolvedValue({ pendingCount: 0 })
    syncNowMock.mockResolvedValue(undefined)
})

describe('countUnsyncedChanges (SEC-46)', () => {
    it('is 0 without checking the DB when local-first is off', async () => {
        isLocalFirstEnabledMock.mockReturnValue(false)

        expect(await countUnsyncedChanges()).toBe(0)
        expect(getSyncStatusMock).not.toHaveBeenCalled()
    })

    it('reports the outbox pending count when local-first is on', async () => {
        getSyncStatusMock.mockResolvedValue({ pendingCount: 3 })

        expect(await countUnsyncedChanges()).toBe(3)
    })

    it('is 0 when the local DB cannot be read', async () => {
        getSyncStatusMock.mockRejectedValue(new Error('no local db'))

        expect(await countUnsyncedChanges()).toBe(0)
    })
})

describe('syncBeforeSignOut (SEC-46)', () => {
    it('flushes then reports zero remaining on success', async () => {
        getSyncStatusMock.mockResolvedValue({ pendingCount: 0 })

        const remaining = await syncBeforeSignOut()

        expect(syncNowMock).toHaveBeenCalledOnce()
        expect(remaining).toBe(0)
    })

    it('reports the still-stuck count when a push is rejected', async () => {
        getSyncStatusMock.mockResolvedValue({ pendingCount: 1 })

        expect(await syncBeforeSignOut()).toBe(1)
    })

    it('recounts even when syncNow throws', async () => {
        syncNowMock.mockRejectedValue(new Error('offline'))
        getSyncStatusMock.mockResolvedValue({ pendingCount: 4 })

        expect(await syncBeforeSignOut()).toBe(4)
    })
})
