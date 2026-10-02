import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, waitFor } from '@/test/test-utils'
import { useWorkspace } from '@/app/providers/useWorkspace'
import axiosInstance from '@lib/axiosInstance'
import { fetchWorkspaces } from '@features/workspaces/workspaceApi'
import { purgeRemovedWorkspaces } from '@platform/sync/syncEngine'
import { isLocalFirstEnabled } from '@lib/localFirstFlag'
import type { User } from '@lib/types/api'
import type { Workspace } from '@features/workspaces/types'

vi.mock('@lib/axiosInstance', () => ({
    default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

vi.mock('@features/workspaces/workspaceApi', () => ({
    fetchWorkspaces: vi.fn(),
}))

vi.mock('@platform/sync/syncEngine', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@platform/sync/syncEngine')>()),
    purgeRemovedWorkspaces: vi.fn().mockResolvedValue(undefined),
    syncNow: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@lib/localFirstFlag', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@lib/localFirstFlag')>()),
    isLocalFirstEnabled: vi.fn(),
}))

const setOnline = (online: boolean): void => {
    Object.defineProperty(navigator, 'onLine', { value: online, writable: true, configurable: true })
}

const mockUser: User = { _id: 'user1', fullName: 'Jamie Rivera', email: 'jamie@example.com' }

const workspace = (id: string): Workspace => ({
    _id: id,
    name: `Workspace ${id}`,
    ownerId: 'someone-else',
    members: [{ userId: mockUser._id, role: 'editor' }],
})

// "ready" also shows before sign-in resolves, so wait for the fetch itself to have run and settled.
const settled = async (): Promise<void> => {
    await waitFor(() => expect(fetchWorkspaces).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('ready'))
}

const Probe = () => {
    const { loading } = useWorkspace()
    return <div data-testid="state">{loading ? 'loading' : 'ready'}</div>
}

describe('WorkspaceContext drops the local copy of workspaces the user has left (SEC-82)', () => {
    beforeEach(() => {
        vi.mocked(axiosInstance.post).mockResolvedValue({
            success: true,
            data: { token: 'tok', user: mockUser, offlineGrant: 'unused-online' },
        })
        vi.mocked(isLocalFirstEnabled).mockReturnValue(true)
        setOnline(true)
    })

    afterEach(() => {
        vi.clearAllMocks()
        setOnline(true)
    })

    it('purges local rows for every workspace missing from an authoritative online list', async () => {
        vi.mocked(fetchWorkspaces).mockResolvedValue([workspace('ws1'), workspace('ws2')])

        renderWithProviders(<Probe />)

        await waitFor(() => expect(purgeRemovedWorkspaces).toHaveBeenCalledWith(['ws1', 'ws2']))
    })

    it('purges everything workspace-scoped when the user belongs to no workspace any more', async () => {
        vi.mocked(fetchWorkspaces).mockResolvedValue([])

        renderWithProviders(<Probe />)

        await waitFor(() => expect(purgeRemovedWorkspaces).toHaveBeenCalledWith([]))
    })

    it('never purges from a list fetched while offline', async () => {
        setOnline(false)
        vi.mocked(fetchWorkspaces).mockResolvedValue([])

        renderWithProviders(<Probe />)

        await settled()
        expect(purgeRemovedWorkspaces).not.toHaveBeenCalled()
    })

    it('never purges when the workspace list could not be fetched', async () => {
        vi.mocked(fetchWorkspaces).mockRejectedValue(new Error('Network Error'))

        renderWithProviders(<Probe />)

        await settled()
        expect(purgeRemovedWorkspaces).not.toHaveBeenCalled()
    })

    it('does nothing on a build without the local-first engine', async () => {
        vi.mocked(isLocalFirstEnabled).mockReturnValue(false)
        vi.mocked(fetchWorkspaces).mockResolvedValue([workspace('ws1')])

        renderWithProviders(<Probe />)

        await settled()
        expect(purgeRemovedWorkspaces).not.toHaveBeenCalled()
    })
})
