import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, waitFor, userEvent } from '../../../test/test-utils'
import DashboardLayout from '../DashboardLayout'
import axiosInstance from '../../../utils/axiosInstance'
import { API_PATHS } from '../../../utils/apiPaths'
import type { ApiResponse, AuthPayload, User } from '../../../types/api'

vi.mock('../../../utils/axiosInstance', () => ({
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
vi.mock('../../../utils/timezoneSync', () => ({
    syncTimezoneOncePerSession: vi.fn().mockResolvedValue(undefined),
    detectTimezone: vi.fn().mockReturnValue('UTC'),
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
