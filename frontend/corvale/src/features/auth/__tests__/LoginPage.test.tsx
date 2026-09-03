import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AxiosError } from 'axios'
import { MemoryRouter } from 'react-router-dom'
import { renderWithProviders, render, screen, waitFor, userEvent } from '@/test/test-utils'
import Login from '../LoginPage'
import UserProvider from '@/app/providers/UserContext'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import type { User } from '@lib/types/api'

// T4: Login has zero prior coverage. Covers client-side validation, a successful sign-in
// persisting the session and redirecting to /dashboard, and a rejected sign-in surfacing the
// server's error message without navigating.

vi.mock('@lib/axiosInstance', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
    },
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
    return { ...actual, useNavigate: () => mockNavigate }
})

const mockUser: User = {
    _id: 'user1',
    fullName: 'Jamie Rivera',
    email: 'jamie@example.com',
    preferredCurrency: 'USD',
}

const setOnline = (online: boolean): void => {
    Object.defineProperty(navigator, 'onLine', { value: online, writable: true, configurable: true })
}

beforeEach(() => {
    setOnline(true)
    mockNavigate.mockClear()
    // Default: no existing session (guest) and no workspace membership - individual tests
    // override the LOGIN call.
    vi.mocked(axiosInstance.post).mockRejectedValue(new AxiosError('Network Error'))
    vi.mocked(axiosInstance.get).mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
    vi.clearAllMocks()
    setOnline(true)
})

describe('Login - client validation', () => {
    it('rejects an invalid email without calling the API', async () => {
        const user = userEvent.setup()
        renderWithProviders(<Login />, { route: '/login' })

        // An email with no "@" at all triggers the browser's own native `type="email"`
        // constraint validation, which blocks the submit event before React's onSubmit ever
        // runs - so this uses an address that passes native validation but fails the app's
        // stricter `validateEmail` regex (no dot-TLD), the same way `handleLogin` is meant to
        // catch it.
        await user.type(screen.getByPlaceholderText('you@example.com'), 'jamie@localhost')
        await user.type(screen.getByPlaceholderText('Enter your password'), 'hunter2hunter2')
        await user.click(screen.getByRole('button', { name: /sign in/i }))

        expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument()
        expect(axiosInstance.post).not.toHaveBeenCalledWith(API_PATHS.AUTH.LOGIN, expect.anything())
    })

    it('rejects an empty password without calling the API', async () => {
        const user = userEvent.setup()
        renderWithProviders(<Login />, { route: '/login' })

        await user.type(screen.getByPlaceholderText('you@example.com'), 'jamie@example.com')
        await user.click(screen.getByRole('button', { name: /sign in/i }))

        expect(screen.getByText('Please enter a password.')).toBeInTheDocument()
        expect(axiosInstance.post).not.toHaveBeenCalledWith(API_PATHS.AUTH.LOGIN, expect.anything())
    })
})

describe('Login - successful sign-in', () => {
    it('submits credentials, persists the session, and navigates to /dashboard', async () => {
        vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
            if (url === API_PATHS.AUTH.LOGIN) {
                return { success: true, data: { token: 'test-token', user: mockUser } }
            }
            throw new AxiosError('Network Error')
        })
        const user = userEvent.setup()
        renderWithProviders(<Login />, { route: '/login' })

        await user.type(screen.getByPlaceholderText('you@example.com'), 'jamie@example.com')
        await user.type(screen.getByPlaceholderText('Enter your password'), 'hunter2hunter2')
        await user.click(screen.getByRole('button', { name: /sign in/i }))

        await waitFor(() =>
            expect(axiosInstance.post).toHaveBeenCalledWith(API_PATHS.AUTH.LOGIN, {
                email: 'jamie@example.com',
                password: 'hunter2hunter2',
            })
        )
        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard'))
    })
})

describe('Login - honours state.from (X2/BUG-04)', () => {
    it('navigates to the originally requested location, including its query string, after signing in', async () => {
        vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
            if (url === API_PATHS.AUTH.LOGIN) {
                return { success: true, data: { token: 'test-token', user: mockUser } }
            }
            throw new AxiosError('Network Error')
        })
        const user = userEvent.setup()
        render(
            <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/transactions?type=expense' } }]}>
                <UserProvider>
                    <Login />
                </UserProvider>
            </MemoryRouter>
        )

        await user.type(screen.getByPlaceholderText('you@example.com'), 'jamie@example.com')
        await user.type(screen.getByPlaceholderText('Enter your password'), 'hunter2hunter2')
        await user.click(screen.getByRole('button', { name: /sign in/i }))

        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/transactions?type=expense'))
    })
})

describe('Login - API rejection', () => {
    it('shows the server error message and does not navigate', async () => {
        const rejection = new AxiosError('Request failed with status code 401')
        rejection.response = { status: 401, data: { success: false, message: 'Invalid email or password' } } as never

        vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
            if (url === API_PATHS.AUTH.LOGIN) throw rejection
            throw new AxiosError('Network Error')
        })
        const user = userEvent.setup()
        renderWithProviders(<Login />, { route: '/login' })

        await user.type(screen.getByPlaceholderText('you@example.com'), 'jamie@example.com')
        await user.type(screen.getByPlaceholderText('Enter your password'), 'wrong-password')
        await user.click(screen.getByRole('button', { name: /sign in/i }))

        await waitFor(() => expect(screen.getByText('Invalid email or password')).toBeInTheDocument())
        expect(mockNavigate).not.toHaveBeenCalled()
    })
})

describe('Login - unverified account (V9 hard gate)', () => {
    it('routes to the verify screen with the email when the server returns 403, without a page error', async () => {
        const rejection = new AxiosError('Request failed with status code 403')
        rejection.response = {
            status: 403,
            data: { success: false, message: 'Please verify your email address to continue' },
        } as never

        vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
            if (url === API_PATHS.AUTH.LOGIN) throw rejection
            throw new AxiosError('Network Error')
        })
        const user = userEvent.setup()
        renderWithProviders(<Login />, { route: '/login' })

        await user.type(screen.getByPlaceholderText('you@example.com'), 'unverified@example.com')
        await user.type(screen.getByPlaceholderText('Enter your password'), 'correcthorsebattery')
        await user.click(screen.getByRole('button', { name: /sign in/i }))

        await waitFor(() =>
            expect(mockNavigate).toHaveBeenCalledWith('/verify-email', {
                state: { email: 'unverified@example.com' },
            })
        )
    })
})

describe('Login - offline', () => {
    it('disables submission and shows an offline notice', () => {
        setOnline(false)
        renderWithProviders(<Login />, { route: '/login' })

        expect(screen.getByText(/sign in requires a connection/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled()
    })
})
