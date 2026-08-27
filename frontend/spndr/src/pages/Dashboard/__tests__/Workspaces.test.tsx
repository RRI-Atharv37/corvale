import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AxiosError } from 'axios'
import { renderWithProviders, screen, waitFor, within, userEvent } from '../../../test/test-utils'
import Workspaces from '../Workspaces'
import axiosInstance from '../../../utils/axiosInstance'
import { API_PATHS } from '../../../utils/apiPaths'
import type { User, Workspace, WorkspaceInvite } from '../../../types/api'

// T4: Workspaces.tsx had zero prior coverage - create/switch/invite/accept/decline/role-gating/
// remove/leave were all untested. Everything here goes through axiosInstance directly (workspace
// writes require connectivity per the offline design decision in ROADMAP.md), so this is a plain
// mocked-axios suite like Categories/Tags/CategorizationRules, not a local-first one.

vi.mock('../../../utils/axiosInstance', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
    },
}))

const mockUser: User = {
    _id: 'user1',
    fullName: 'Jamie Rivera',
    email: 'jamie@example.com',
    preferredCurrency: 'USD',
}

const ownedWorkspace: Workspace = {
    _id: 'ws-owned',
    name: 'Household',
    ownerId: 'user1',
    members: [
        { userId: 'user1', role: 'owner', fullName: 'Jamie Rivera', email: 'jamie@example.com' },
        { userId: 'user2', role: 'editor', fullName: 'Alex Kim', email: 'alex@example.com' },
    ],
}

const memberWorkspace: Workspace = {
    _id: 'ws-member',
    name: 'Roommates',
    ownerId: 'user9',
    members: [
        { userId: 'user9', role: 'owner', fullName: 'Robin Vega', email: 'robin@example.com' },
        { userId: 'user1', role: 'editor', fullName: 'Jamie Rivera', email: 'jamie@example.com' },
    ],
}

const receivedInvite: WorkspaceInvite = {
    _id: 'invite-1',
    workspaceId: 'ws-other',
    workspaceName: 'Family budget',
    inviterUserId: 'user5',
    inviterName: 'Robin Vega',
    inviteeUserId: 'user1',
    inviteeEmail: 'jamie@example.com',
    role: 'editor',
    status: 'pending',
    createdAt: new Date().toISOString(),
}

/** Mutable so tests that create/remove/leave can prove the follow-up refetch reflects the change. */
let workspacesState: Workspace[] = []
let receivedInvitesState: WorkspaceInvite[] = []

const setOnline = (online: boolean): void => {
    Object.defineProperty(navigator, 'onLine', { value: online, writable: true, configurable: true })
}

beforeEach(() => {
    setOnline(true)
    localStorage.removeItem('corvale_active_workspace_id')
    workspacesState = [ownedWorkspace, memberWorkspace]
    receivedInvitesState = [receivedInvite]

    vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
        if (url === API_PATHS.AUTH.REFRESH) {
            return { success: true, data: { token: 'test-token', user: mockUser } }
        }
        return { success: true, data: [] }
    })
    vi.mocked(axiosInstance.get).mockImplementation(async (url: string) => {
        if (url === API_PATHS.WORKSPACES.GET_ALL) return { success: true, data: workspacesState }
        if (url === API_PATHS.WORKSPACES.RECEIVED_INVITES) {
            return { success: true, data: receivedInvitesState }
        }
        if (url.includes('/invites')) return { success: true, data: [] }
        return { success: true, data: [] }
    })
})

afterEach(() => {
    vi.clearAllMocks()
    setOnline(true)
})

describe('Workspaces - listing', () => {
    it('lists every workspace the user belongs to with its role badge and member count', async () => {
        renderWithProviders(<Workspaces />, { route: '/workspaces' })

        await waitFor(() => expect(screen.getByText('Household')).toBeInTheDocument())
        expect(screen.getByText('Roommates')).toBeInTheDocument()
        expect(screen.getAllByText('Owner').length).toBeGreaterThan(0)
        expect(screen.getAllByText('Editor').length).toBeGreaterThan(0)
        expect(screen.getAllByText('2 members')).toHaveLength(2)
    })
})

describe('Workspaces - create', () => {
    it('creates a workspace, refetches the list, and makes it the active workspace', async () => {
        const created: Workspace = { _id: 'ws-new', name: 'New crew', ownerId: 'user1', members: [] }
        vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
            if (url === API_PATHS.AUTH.REFRESH) {
                return { success: true, data: { token: 'test-token', user: mockUser } }
            }
            if (url === API_PATHS.WORKSPACES.CREATE) {
                workspacesState = [...workspacesState, created]
                return { success: true, data: created }
            }
            return { success: true, data: [] }
        })
        const user = userEvent.setup()
        renderWithProviders(<Workspaces />, { route: '/workspaces' })
        await waitFor(() => expect(screen.getByText('Household')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: /new workspace/i }))
        const dialog = await screen.findByRole('dialog', { name: 'Create workspace' })
        await user.type(within(dialog).getByPlaceholderText('Roommates, Family budget, etc.'), 'New crew')
        await user.click(within(dialog).getByRole('button', { name: 'Create workspace' }))

        await waitFor(() =>
            expect(axiosInstance.post).toHaveBeenCalledWith(API_PATHS.WORKSPACES.CREATE, { name: 'New crew' })
        )
        await waitFor(() => expect(screen.getByText('New crew')).toBeInTheDocument())
        const newCard = screen.getByText('New crew').closest('div.card') as HTMLElement
        expect(within(newCard).getByText('Active')).toBeInTheDocument()
    })
})

describe('Workspaces - members modal role gating', () => {
    it('shows the invite form for the workspace owner', async () => {
        const user = userEvent.setup()
        renderWithProviders(<Workspaces />, { route: '/workspaces' })
        await waitFor(() => expect(screen.getByText('Household')).toBeInTheDocument())

        const householdCard = screen.getByText('Household').closest('div.card') as HTMLElement
        await user.click(within(householdCard).getByRole('button', { name: /members/i }))

        const dialog = await screen.findByRole('dialog')
        expect(within(dialog).getByPlaceholderText('colleague@example.com')).toBeInTheDocument()
        expect(within(dialog).queryByRole('button', { name: /leave workspace/i })).not.toBeInTheDocument()
    })

    it('hides the invite form and shows "leave workspace" for a non-owner member', async () => {
        const user = userEvent.setup()
        renderWithProviders(<Workspaces />, { route: '/workspaces' })
        await waitFor(() => expect(screen.getByText('Roommates')).toBeInTheDocument())

        const roommatesCard = screen.getByText('Roommates').closest('div.card') as HTMLElement
        await user.click(within(roommatesCard).getByRole('button', { name: /members/i }))

        const dialog = await screen.findByRole('dialog')
        expect(within(dialog).queryByPlaceholderText('colleague@example.com')).not.toBeInTheDocument()
        expect(within(dialog).getByRole('button', { name: /leave workspace/i })).toBeInTheDocument()
    })
})

describe('Workspaces - invite a member', () => {
    it('sends an invite with the chosen email and role', async () => {
        const user = userEvent.setup()
        renderWithProviders(<Workspaces />, { route: '/workspaces' })
        await waitFor(() => expect(screen.getByText('Household')).toBeInTheDocument())

        const householdCard = screen.getByText('Household').closest('div.card') as HTMLElement
        await user.click(within(householdCard).getByRole('button', { name: /members/i }))
        const dialog = await screen.findByRole('dialog')

        // The invite <form> and each manageable member's role <select> both render inside the
        // same members dialog, so scope to the invite form specifically to avoid ambiguity.
        const inviteForm = dialog.querySelector('form') as HTMLFormElement
        await user.type(within(inviteForm).getByPlaceholderText('colleague@example.com'), 'new.person@example.com')
        await user.selectOptions(within(inviteForm).getByRole('combobox'), 'viewer')
        await user.click(within(inviteForm).getByRole('button', { name: /send invite/i }))

        await waitFor(() =>
            expect(axiosInstance.post).toHaveBeenCalledWith(API_PATHS.WORKSPACES.INVITE('ws-owned'), {
                email: 'new.person@example.com',
                role: 'viewer',
            })
        )
    })

    it('keeps the members modal open and the typed email intact when the invite fails', async () => {
        vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
            if (url === API_PATHS.AUTH.REFRESH) {
                return { success: true, data: { token: 'test-token', user: mockUser } }
            }
            if (url === API_PATHS.WORKSPACES.INVITE('ws-owned')) {
                throw new AxiosError('Request failed with status code 404')
            }
            return { success: true, data: [] }
        })
        const user = userEvent.setup()
        renderWithProviders(<Workspaces />, { route: '/workspaces' })
        await waitFor(() => expect(screen.getByText('Household')).toBeInTheDocument())

        const householdCard = screen.getByText('Household').closest('div.card') as HTMLElement
        await user.click(within(householdCard).getByRole('button', { name: /members/i }))
        const dialog = await screen.findByRole('dialog')

        await user.type(within(dialog).getByPlaceholderText('colleague@example.com'), 'nobody@example.com')
        await user.click(within(dialog).getByRole('button', { name: /send invite/i }))

        await waitFor(() => expect(axiosInstance.post).toHaveBeenCalledWith(API_PATHS.WORKSPACES.INVITE('ws-owned'), {
            email: 'nobody@example.com',
            role: 'editor',
        }))
        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(within(screen.getByRole('dialog')).getByPlaceholderText('colleague@example.com')).toHaveValue(
            'nobody@example.com'
        )
    })
})

describe('Workspaces - received invitations', () => {
    it('accepts a received invitation and refreshes the workspace list', async () => {
        vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
            if (url === API_PATHS.AUTH.REFRESH) {
                return { success: true, data: { token: 'test-token', user: mockUser } }
            }
            if (url === API_PATHS.WORKSPACES.ACCEPT_INVITE('invite-1')) {
                receivedInvitesState = []
                return { success: true, data: { ...ownedWorkspace, name: 'Family budget' } }
            }
            return { success: true, data: [] }
        })
        const user = userEvent.setup()
        renderWithProviders(<Workspaces />, { route: '/workspaces' })
        await waitFor(() => expect(screen.getByText('Household')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: /invitations/i }))
        await waitFor(() => expect(screen.getByText('Family budget')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: /^accept$/i }))

        await waitFor(() =>
            expect(axiosInstance.post).toHaveBeenCalledWith(API_PATHS.WORKSPACES.ACCEPT_INVITE('invite-1'))
        )
        await waitFor(() => expect(screen.queryByText('Family budget')).not.toBeInTheDocument())
    })

    it('declines a received invitation and removes it from the list', async () => {
        vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
            if (url === API_PATHS.AUTH.REFRESH) {
                return { success: true, data: { token: 'test-token', user: mockUser } }
            }
            if (url === API_PATHS.WORKSPACES.DECLINE_INVITE('invite-1')) {
                receivedInvitesState = []
                return { success: true, data: undefined }
            }
            return { success: true, data: [] }
        })
        const user = userEvent.setup()
        renderWithProviders(<Workspaces />, { route: '/workspaces' })
        await waitFor(() => expect(screen.getByText('Household')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: /invitations/i }))
        await waitFor(() => expect(screen.getByText('Family budget')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: /^decline$/i }))

        await waitFor(() =>
            expect(axiosInstance.post).toHaveBeenCalledWith(API_PATHS.WORKSPACES.DECLINE_INVITE('invite-1'))
        )
        await waitFor(() => expect(screen.queryByText('Family budget')).not.toBeInTheDocument())
    })
})

describe('Workspaces - remove and leave', () => {
    it('removes a member as the workspace owner', async () => {
        vi.mocked(axiosInstance.delete).mockImplementation(async (url: string) => {
            if (url === API_PATHS.WORKSPACES.REMOVE_MEMBER('ws-owned', 'user2')) {
                return {
                    success: true,
                    data: { ...ownedWorkspace, members: ownedWorkspace.members.filter((m) => m.userId !== 'user2') },
                }
            }
            throw new AxiosError('unexpected DELETE')
        })
        const user = userEvent.setup()
        renderWithProviders(<Workspaces />, { route: '/workspaces' })
        await waitFor(() => expect(screen.getByText('Household')).toBeInTheDocument())

        const householdCard = screen.getByText('Household').closest('div.card') as HTMLElement
        await user.click(within(householdCard).getByRole('button', { name: /members/i }))
        const membersDialog = await screen.findByRole('dialog')

        await user.click(within(membersDialog).getByRole('button', { name: 'Remove Alex Kim' }))
        // Modal.tsx gives every instance's heading the same `id="modal-title"`, so with two
        // modals open at once `getByRole('dialog', { name })` can't disambiguate by accessible
        // name - locate the confirm dialog by its message text instead.
        const confirmMessage = await screen.findByText(/remove alex kim from this workspace/i)
        const confirmDialog = confirmMessage.closest('[role="dialog"]') as HTMLElement
        await user.click(within(confirmDialog).getByRole('button', { name: 'Remove' }))

        await waitFor(() =>
            expect(axiosInstance.delete).toHaveBeenCalledWith(API_PATHS.WORKSPACES.REMOVE_MEMBER('ws-owned', 'user2'))
        )
    })

    it('lets a non-owner member leave a workspace', async () => {
        vi.mocked(axiosInstance.delete).mockImplementation(async (url: string) => {
            if (url === API_PATHS.WORKSPACES.REMOVE_MEMBER('ws-member', 'user1')) {
                workspacesState = workspacesState.filter((w) => w._id !== 'ws-member')
                return { success: true, data: memberWorkspace }
            }
            throw new AxiosError('unexpected DELETE')
        })
        const user = userEvent.setup()
        renderWithProviders(<Workspaces />, { route: '/workspaces' })
        await waitFor(() => expect(screen.getByText('Roommates')).toBeInTheDocument())

        const roommatesCard = screen.getByText('Roommates').closest('div.card') as HTMLElement
        await user.click(within(roommatesCard).getByRole('button', { name: /members/i }))
        const membersDialog = await screen.findByRole('dialog')

        await user.click(within(membersDialog).getByRole('button', { name: /leave workspace/i }))
        const confirmMessage = await screen.findByText(/leave "roommates"/i)
        const confirmDialog = confirmMessage.closest('[role="dialog"]') as HTMLElement
        await user.click(within(confirmDialog).getByRole('button', { name: 'Leave' }))

        await waitFor(() =>
            expect(axiosInstance.delete).toHaveBeenCalledWith(API_PATHS.WORKSPACES.REMOVE_MEMBER('ws-member', 'user1'))
        )
    })
})

describe('Workspaces - error paths', () => {
    it('shows a retryable error state when the workspace list fails to load', async () => {
        const rejection = new AxiosError('Request failed with status code 500')
        rejection.response = { status: 500, data: { message: 'Failed to load workspaces' } } as never

        vi.mocked(axiosInstance.get).mockImplementation(async (url: string) => {
            if (url === API_PATHS.WORKSPACES.GET_ALL) throw rejection
            if (url === API_PATHS.WORKSPACES.RECEIVED_INVITES) return { success: true, data: [] }
            return { success: true, data: [] }
        })
        const user = userEvent.setup()
        renderWithProviders(<Workspaces />, { route: '/workspaces' })

        await waitFor(() => expect(screen.getByText('Failed to load workspaces')).toBeInTheDocument())
        const retry = screen.getByRole('button', { name: /try again/i })

        vi.mocked(axiosInstance.get).mockImplementation(async (url: string) => {
            if (url === API_PATHS.WORKSPACES.GET_ALL) return { success: true, data: workspacesState }
            if (url === API_PATHS.WORKSPACES.RECEIVED_INVITES) return { success: true, data: [] }
            return { success: true, data: [] }
        })
        await user.click(retry)

        await waitFor(() => expect(screen.getByText('Household')).toBeInTheDocument())
    })

    it('keeps the create-workspace modal open and the workspace unlisted when creation fails', async () => {
        vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
            if (url === API_PATHS.AUTH.REFRESH) {
                return { success: true, data: { token: 'test-token', user: mockUser } }
            }
            if (url === API_PATHS.WORKSPACES.CREATE) throw new AxiosError('Request failed with status code 500')
            return { success: true, data: [] }
        })
        const user = userEvent.setup()
        renderWithProviders(<Workspaces />, { route: '/workspaces' })
        await waitFor(() => expect(screen.getByText('Household')).toBeInTheDocument())

        await user.click(screen.getByRole('button', { name: /new workspace/i }))
        const dialog = await screen.findByRole('dialog', { name: 'Create workspace' })
        await user.type(within(dialog).getByPlaceholderText('Roommates, Family budget, etc.'), 'Doomed crew')
        await user.click(within(dialog).getByRole('button', { name: 'Create workspace' }))

        await waitFor(() =>
            expect(axiosInstance.post).toHaveBeenCalledWith(API_PATHS.WORKSPACES.CREATE, { name: 'Doomed crew' })
        )
        expect(screen.getByRole('dialog', { name: 'Create workspace' })).toBeInTheDocument()
        expect(screen.queryByText('Doomed crew')).not.toBeInTheDocument()
    })
})
