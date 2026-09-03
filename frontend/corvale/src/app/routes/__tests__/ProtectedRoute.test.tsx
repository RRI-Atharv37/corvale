import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AxiosError } from 'axios'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { render, screen, waitFor } from '@testing-library/react'
import ProtectedRoute from '../ProtectedRoute'
import UserProvider from '../../providers/UserContext'
import axiosInstance from '@lib/axiosInstance'

// X2/BUG-04: an unauthenticated visit to a protected route must redirect to /login carrying the
// full attempted path - including the query string, which the old `location.pathname`-only
// capture dropped - as `state.from`, so Login can send the user back where they meant to go.
// X1/BUG-07 depends on this too: once UserContext clears itself (SESSION_EXPIRED_EVENT), this is
// the redirect that fires, and it must land on /login rather than the marketing landing page.

vi.mock('@lib/axiosInstance', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
    },
}))

beforeEach(() => {
    vi.mocked(axiosInstance.post).mockRejectedValue(new AxiosError('Network Error'))
    vi.mocked(axiosInstance.get).mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
    vi.clearAllMocks()
})

const LoginProbe = () => {
    const location = useLocation()
    const from = (location.state as { from?: string } | null)?.from
    return <div data-testid="login-probe">{from ?? 'no-from'}</div>
}

const renderProtected = (initialPath: string) =>
    render(
        <MemoryRouter initialEntries={[initialPath]}>
            <UserProvider>
                <Routes>
                    <Route path="/login" element={<LoginProbe />} />
                    <Route
                        path="/transactions"
                        element={
                            <ProtectedRoute>
                                <div>Secret dashboard content</div>
                            </ProtectedRoute>
                        }
                    />
                </Routes>
            </UserProvider>
        </MemoryRouter>
    )

describe('ProtectedRoute - unauthenticated redirect', () => {
    it('redirects to /login carrying the full attempted path, including the query string, as state.from', async () => {
        renderProtected('/transactions?type=expense')

        await waitFor(() => expect(screen.getByTestId('login-probe')).toBeInTheDocument())
        expect(screen.getByTestId('login-probe')).toHaveTextContent('/transactions?type=expense')
        expect(screen.queryByText('Secret dashboard content')).not.toBeInTheDocument()
    })

    it('redirects to /login with just the path when there is no query string', async () => {
        renderProtected('/transactions')

        await waitFor(() => expect(screen.getByTestId('login-probe')).toBeInTheDocument())
        expect(screen.getByTestId('login-probe')).toHaveTextContent('/transactions')
    })
})
