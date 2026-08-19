import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, waitFor } from '../../test/test-utils'
import { useWorkspace } from '../../hooks/useWorkspace'
import axiosInstance from '../../utils/axiosInstance'
import { fetchWorkspaces } from '../../utils/workspaceApi'
import { ACTIVE_WORKSPACE_STORAGE_KEY } from '../../utils/workspaceScope'
import type { User, Workspace } from '../../types/api'

// Pins the fix for the bug flagged in TODO.md Sprint 13.7: WorkspaceContext currently
// clears the stored `activeWorkspaceId` whenever `refetchWorkspaces()` produces a list
// that doesn't include it - including when that list is empty because the fetch itself
// failed or ran offline. The correct behavior: only an *authoritative* (online,
// successful) fetch may clear the stored workspace; a failed or offline-empty fetch
// must leave it untouched so the user doesn't silently lose their workspace context
// the moment connectivity drops.

vi.mock('../../utils/axiosInstance', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        patch: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
    },
}))

vi.mock('../../utils/workspaceApi', () => ({
    fetchWorkspaces: vi.fn(),
}))

const setOnline = (online: boolean): void => {
    Object.defineProperty(navigator, 'onLine', { value: online, writable: true, configurable: true })
}

const mockUser: User = {
    _id: 'user1',
    fullName: 'Jamie Rivera',
    email: 'jamie@example.com',
}

const workspace = (id: string): Workspace => ({
    _id: id,
    name: `Workspace ${id}`,
    ownerId: mockUser._id,
    members: [{ userId: mockUser._id, role: 'owner' }],
})

const WorkspaceProbe = () => {
    const { activeWorkspaceId, loading } = useWorkspace()
    return <div data-testid="active-ws">{loading ? 'loading' : activeWorkspaceId ?? 'none'}</div>
}

describe('WorkspaceContext offline fallback for the stored active workspace', () => {
    beforeEach(() => {
        localStorage.setItem('token', 'tok')
        localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, 'ws1')
        vi.mocked(axiosInstance.get).mockResolvedValue({ success: true, data: mockUser })
        setOnline(true)
    })

    afterEach(() => {
        vi.clearAllMocks()
        setOnline(true)
    })

    it('keeps the stored active workspace when an offline fetch fails outright', async () => {
        setOnline(false)
        vi.mocked(fetchWorkspaces).mockRejectedValue(new Error('Network Error'))

        renderWithProviders(<WorkspaceProbe />)

        await waitFor(() => expect(screen.getByTestId('active-ws')).not.toHaveTextContent('loading'))

        expect(screen.getByTestId('active-ws')).toHaveTextContent('ws1')
        expect(localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBe('ws1')
    })

    it('keeps the stored active workspace when an offline fetch resolves empty', async () => {
        setOnline(false)
        vi.mocked(fetchWorkspaces).mockResolvedValue([])

        renderWithProviders(<WorkspaceProbe />)

        await waitFor(() => expect(screen.getByTestId('active-ws')).not.toHaveTextContent('loading'))

        expect(screen.getByTestId('active-ws')).toHaveTextContent('ws1')
        expect(localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBe('ws1')
    })

    it('clears the stored active workspace once an authoritative online fetch confirms the user is no longer a member', async () => {
        vi.mocked(fetchWorkspaces).mockResolvedValue([workspace('ws2')])

        renderWithProviders(<WorkspaceProbe />)

        await waitFor(() => expect(screen.getByTestId('active-ws')).toHaveTextContent('none'))

        expect(localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBeNull()
    })

    it('keeps the stored active workspace when the online fetch still includes it', async () => {
        vi.mocked(fetchWorkspaces).mockResolvedValue([workspace('ws1'), workspace('ws2')])

        renderWithProviders(<WorkspaceProbe />)

        await waitFor(() => expect(screen.getByTestId('active-ws')).toHaveTextContent('ws1'))
    })
})
