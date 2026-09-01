import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, userEvent, waitFor } from '../../../test/test-utils'

import type { SyncStatus } from '../../../sync/syncEngine'

const syncStatus = {
    online: true,
    pendingCount: 0,
    conflictCount: 0,
    failedCount: 0,
    failedOps: [] as SyncStatus['failedOps'],
    lastSyncedAt: null as string | null,
    syncing: false,
    syncNow: vi.fn(),
    resetLocalData: vi.fn(),
    retryOp: vi.fn(),
    discardOp: vi.fn(),
}

vi.mock('../../../hooks/useSyncStatus', () => ({
    useSyncStatus: () => syncStatus,
}))
vi.mock('../../../hooks/useOnlineStatus', () => ({
    useOnlineStatus: () => true,
}))
vi.mock('../../../db/localDbInstance', () => ({
    getLocalDb: vi.fn().mockResolvedValue({}),
}))
vi.mock('../../../sync/conflicts', () => ({
    listUnresolvedConflicts: vi.fn().mockResolvedValue([]),
    resolveConflict: vi.fn(),
}))

const { default: SyncStatusBadge } = await import('../SyncStatusBadge')

const originalConfirm = window.confirm

beforeEach(() => {
    Object.assign(syncStatus, {
        online: true,
        pendingCount: 0,
        conflictCount: 0,
        failedCount: 0,
        failedOps: [],
        lastSyncedAt: new Date().toISOString(),
        syncing: false,
    })
})

afterEach(() => {
    vi.clearAllMocks()
    window.confirm = originalConfirm
})

describe('SyncStatusBadge - BUG-32 rejected ops', () => {
    it('shows "No sync issues" only when nothing is failed or conflicting', async () => {
        const user = userEvent.setup()
        render(<SyncStatusBadge />)
        await user.click(screen.getByRole('button', { name: /sync status/i }))
        expect(screen.getByText(/no sync issues/i)).toBeInTheDocument()
    })

    it('surfaces a rejected op with its server message and a retry / discard action', async () => {
        syncStatus.pendingCount = 1
        syncStatus.failedCount = 1
        syncStatus.failedOps = [
            {
                opId: 'op1',
                entity: 'transaction:txn1',
                operation: 'update',
                lastError: 'Account not found',
                attempts: 4,
            },
        ]
        const user = userEvent.setup()
        render(<SyncStatusBadge />)

        // The healthy warning icon doubles as the "issues" signal.
        expect(screen.getByLabelText(/sync issues/i)).toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: /sync status/i }))
        expect(screen.getByText(/1 change rejected by the server/i)).toBeInTheDocument()
        expect(screen.getByText(/account not found/i)).toBeInTheDocument()
        expect(screen.queryByText(/no sync issues/i)).not.toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: /retry now/i }))
        await waitFor(() => expect(syncStatus.retryOp).toHaveBeenCalledWith('op1'))
    })

    it('confirms before discarding a rejected change', async () => {
        syncStatus.pendingCount = 1
        syncStatus.failedCount = 1
        syncStatus.failedOps = [
            { opId: 'op9', entity: 'account:acc1', operation: 'update', lastError: 'nope', attempts: 2 },
        ]
        window.confirm = vi.fn().mockReturnValue(true)
        const user = userEvent.setup()
        render(<SyncStatusBadge />)
        await user.click(screen.getByRole('button', { name: /sync status/i }))

        await user.click(screen.getByRole('button', { name: /discard this change/i }))

        expect(window.confirm).toHaveBeenCalled()
        await waitFor(() => expect(syncStatus.discardOp).toHaveBeenCalledWith('op9'))
    })
})
