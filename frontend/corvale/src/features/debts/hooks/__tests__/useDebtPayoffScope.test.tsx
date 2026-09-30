import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { getLocalDb, resetLocalDbForTests } from '@platform/db/localDbInstance'
import { Repository } from '@platform/db/repositories/Repository'
import type { LocalAccount } from '@domain/types'
import { useDebtPayoffData } from '../useDebtPayoffData'

/**
 * BUG-73 (S55): the debts page's local account list depended on the active workspace but never
 * refetched when it changed, so it kept showing the previous scope's accounts.
 */

const workspaceState = vi.hoisted(() => ({ activeWorkspaceId: null as string | null }))

vi.mock('@/app/providers/useWorkspace', () => ({
    useWorkspace: () => ({ activeWorkspaceId: workspaceState.activeWorkspaceId }),
}))

vi.mock('@lib/axiosInstance', () => ({
    default: { get: vi.fn(), post: vi.fn() },
}))

const accountsRepo = new Repository<LocalAccount>('accounts')

beforeEach(() => {
    workspaceState.activeWorkspaceId = null
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
})

describe('useDebtPayoffData (local-first) refetches on workspace switch (BUG-73)', () => {
    it('swaps the account list to the new scope without a manual refetch', async () => {
        vi.stubEnv('VITE_LOCAL_FIRST', 'true')
        resetLocalDbForTests()
        const db = await getLocalDb()
        await accountsRepo.upsertFromServer(db, [
            { _id: 'acc-p', updatedAt: new Date().toISOString(), userId: 'user1', workspaceId: null, name: 'Personal card', type: 'credit', currency: 'USD', currentBalance: 500, isArchived: false },
            { _id: 'acc-w', updatedAt: new Date().toISOString(), userId: 'user1', workspaceId: 'ws-1', name: 'Shared card', type: 'credit', currency: 'USD', currentBalance: 900, isArchived: false },
        ])

        const { result, rerender } = renderHook(() => useDebtPayoffData())
        await waitFor(() => expect(result.current.accounts?.map((account) => account.name)).toEqual(['Personal card']))

        workspaceState.activeWorkspaceId = 'ws-1'
        rerender()
        await waitFor(() => expect(result.current.accounts?.map((account) => account.name)).toEqual(['Shared card']))
    })
})
