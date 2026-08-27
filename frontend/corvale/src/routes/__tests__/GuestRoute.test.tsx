import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { render, screen, waitFor } from '@testing-library/react'
import GuestRoute from '../GuestRoute'
import UserProvider from '../../context/UserContext'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import type { User } from '../../types/api'

// X2/BUG-04: an already-authenticated visitor to /login is bounced onward by GuestRoute, not
// Login itself. Discovered while manually verifying the state.from fix: GuestRoute's own
// `<Navigate to="/dashboard">` was racing Login's `navigate(from)` call (both fire off the same
// `updateUser` state change) and winning, silently discarding `from`. GuestRoute must honour the
// same `state.from` so it doesn't matter which of the two redirects actually lands.

vi.mock('../../utils/axiosInstance', () => ({
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
}

beforeEach(() => {
    vi.mocked(axiosInstance.get).mockResolvedValue({ success: true, data: [] })
    vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
        if (url === API_PATHS.AUTH.REFRESH) {
            return { success: true, data: { token: 'test-token', user: mockUser, offlineGrant: null } }
        }
        throw new Error('unused in this suite')
    })
})

afterEach(() => {
    vi.clearAllMocks()
})

const renderGuestRoute = (initialEntry: string | { pathname: string; state?: unknown }) =>
    render(
        <MemoryRouter initialEntries={[initialEntry]}>
            <UserProvider>
                <Routes>
                    <Route
                        path="/login"
                        element={
                            <GuestRoute>
                                <div>Login form</div>
                            </GuestRoute>
                        }
                    />
                    <Route path="/dashboard" element={<div data-testid="landed">dashboard</div>} />
                    <Route path="/transactions" element={<div data-testid="landed">transactions</div>} />
                </Routes>
            </UserProvider>
        </MemoryRouter>
    )

describe('GuestRoute - authenticated redirect honours state.from (X2/BUG-04)', () => {
    it('redirects to the originally requested location when one was captured', async () => {
        renderGuestRoute({ pathname: '/login', state: { from: '/transactions' } })

        await waitFor(() => expect(screen.getByTestId('landed')).toHaveTextContent('transactions'))
    })

    it('falls back to /dashboard when there is no state.from', async () => {
        renderGuestRoute('/login')

        await waitFor(() => expect(screen.getByTestId('landed')).toHaveTextContent('dashboard'))
    })
})
