import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, waitFor } from '@/test/test-utils'
import { useWorkspace } from '@/app/providers/useWorkspace'
import axiosInstance from '@lib/axiosInstance'
import { fetchWorkspaces } from '@features/workspaces/workspaceApi'
import { ACTIVE_WORKSPACE_STORAGE_KEY } from '@lib/workspaceScope'
import type { User, Workspace } from '@lib/types/api'

// Pins the fix for a bug in WorkspaceContext: it currently
// clears the stored `activeWorkspaceId` whenever `refetchWorkspaces()` produces a list
// that doesn't include it - including when that list is empty because the fetch itself
// failed or ran offline. The correct behavior: only an *authoritative* (online,
// successful) fetch may clear the stored workspace; a failed or offline-empty fetch
// must leave it untouched so the user doesn't silently lose their workspace context
// the moment connectivity drops.

vi.mock('@lib/axiosInstance', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        patch: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
    },
}))

vi.mock('@features/workspaces/workspaceApi', () => ({
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
        localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, 'ws1')
        // restoreSession now goes through POST /auth/refresh (S16/SEC-18) rather than a stored
        // token + GET /auth/user - mocked to resolve unconditionally so `isAuthenticated` is
        // true regardless of the `setOnline` value each test below sets before rendering
        // (the mock doesn't actually consult `navigator.onLine`; only the real axios instance's
        // request would fail while offline).
        vi.mocked(axiosInstance.post).mockResolvedValue({
            success: true,
            data: { token: 'tok', user: mockUser, offlineGrant: 'unused-online' },
        })
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
