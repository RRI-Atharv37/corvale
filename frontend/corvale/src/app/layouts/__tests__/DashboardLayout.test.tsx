import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, waitFor, userEvent } from '@/test/test-utils'
import DashboardLayout from '../DashboardLayout'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import type { ApiResponse, User } from '@lib/types/api'
import type { AuthPayload } from '@features/auth/types'

vi.mock('@lib/axiosInstance', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        patch: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
    },
}))

// V5: the layout kicks off a once-per-session timezone resync. That path has its own test
// (`utils/__tests__/timezoneSync.test.ts`); here it's stubbed so it can't PATCH /auth/user
// depending on the CI runner's system timezone.
vi.mock('@platform/timezoneSync', () => ({
    syncTimezoneOncePerSession: vi.fn().mockResolvedValue(undefined),
    detectTimezone: vi.fn().mockReturnValue('UTC'),
}))

// SEC-46: the sign-out unsynced-changes guard. Default: nothing pending, so Logout signs out
// straight away; overridden per-test to open the dialog.
const { countUnsyncedChangesMock, syncBeforeSignOutMock } = vi.hoisted(() => ({
    countUnsyncedChangesMock: vi.fn().mockResolvedValue(0),
    syncBeforeSignOutMock: vi.fn().mockResolvedValue(0),
}))
vi.mock('@platform/offline/signOutFlow', () => ({
    countUnsyncedChanges: countUnsyncedChangesMock,
    syncBeforeSignOut: syncBeforeSignOutMock,
}))

const mockUser: User = {
    _id: 'user1',
    fullName: 'Jamie Rivera',
    email: 'jamie@example.com',
    timezone: 'UTC',
    preferredCurrency: 'USD',
    exchangeRates: {},
}

beforeEach(() => {
    vi.mocked(axiosInstance.get).mockRejectedValue(new Error('not mocked in this test'))
    vi.mocked(axiosInstance.post).mockImplementation((url: string) => {
        if (url === API_PATHS.AUTH.REFRESH) {
            const body: ApiResponse<AuthPayload> = {
                success: true,
                data: { token: 'test-token', user: mockUser },
            }
            return Promise.resolve(body)
        }
        return Promise.reject(new Error(`unexpected POST ${url}`))
    })
})

afterEach(() => {
    vi.clearAllMocks()
})

describe('DashboardLayout settings panel', () => {
    it('links to the desktop download page', async () => {
        renderWithProviders(<DashboardLayout />)
        await waitFor(() => expect(screen.getByText('Jamie Rivera')).toBeInTheDocument())

        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: /open settings/i }))

        const link = await screen.findByRole('link', { name: /get the desktop app/i })
        expect(link).toHaveAttribute('href', '/download')
    })
})

describe('DashboardLayout navigation', () => {
    it('labels the /reports nav link "Reports & Analytics" so it reads as the analytics page', async () => {
        renderWithProviders(<DashboardLayout />)
        await waitFor(() => expect(screen.getByText('Jamie Rivera')).toBeInTheDocument())

        const link = screen.getByRole('link', { name: 'Reports & Analytics' })
        expect(link).toHaveAttribute('href', '/reports')
    })
})

describe('DashboardLayout sign-out (SEC-46)', () => {
    it('warns before discarding unsynced local changes on sign out', async () => {
        countUnsyncedChangesMock.mockResolvedValueOnce(3)
        renderWithProviders(<DashboardLayout />)
        await waitFor(() => expect(screen.getByText('Jamie Rivera')).toBeInTheDocument())

        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: /open settings/i }))
        await user.click(screen.getByRole('button', { name: /^logout$/i }))

        expect(
            await screen.findByText(/3 changes on this device have not synced/i)
        ).toBeInTheDocument()
    })

    it('signs out straight away when nothing is pending', async () => {
        countUnsyncedChangesMock.mockResolvedValue(0)
        renderWithProviders(<DashboardLayout />)
        await waitFor(() => expect(screen.getByText('Jamie Rivera')).toBeInTheDocument())

        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: /open settings/i }))
        await user.click(screen.getByRole('button', { name: /^logout$/i }))

        await waitFor(() =>
            expect(screen.queryByText(/have not synced/i)).not.toBeInTheDocument()
        )
    })
})
