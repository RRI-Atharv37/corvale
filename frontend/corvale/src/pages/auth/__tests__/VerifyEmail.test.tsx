import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AxiosError } from 'axios'
import { MemoryRouter } from 'react-router-dom'
import { render, renderWithProviders, screen, waitFor, userEvent } from '../../../test/test-utils'
import VerifyEmail from '../VerifyEmail'
import UserProvider from '../../../context/UserContext'
import WorkspaceProvider from '../../../context/WorkspaceContext'
import { useUser } from '../../../hooks/useUser'
import axiosInstance from '../../../utils/axiosInstance'
import { API_PATHS } from '../../../utils/apiPaths'
import type { User } from '../../../types/api'

// T4: VerifyEmail had zero prior coverage. Covers the no-token "awaiting" state, a successful
// confirmation for a signed-out visitor (the common case - following an email link), a failed
// confirmation, and the resend action for an already-authenticated visitor.
//
// The "already authenticated" cases render through a small gate that waits for UserProvider's own
// session restore to resolve before mounting VerifyEmail - VerifyEmail reads `isAuthenticated`
// inside a mount-only effect (`[token]` deps, not `[token, isAuthenticated]`), so mounting it
// before the surrounding UserProvider has resolved its own session would capture a stale `false`
// regardless of what the session restore later resolves to.

vi.mock('../../../utils/axiosInstance', () => ({
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
    _id: 'user3',
    fullName: 'Sam Lee',
    email: 'sam@example.com',
    preferredCurrency: 'USD',
}

const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { isAuthenticated, isInitializing } = useUser()
    if (isInitializing || !isAuthenticated) return <p>waiting-for-session</p>
    return <>{children}</>
}

const renderAuthenticated = (route: string) =>
    render(
        <MemoryRouter initialEntries={[route]}>
            <UserProvider>
                <WorkspaceProvider>
                    <AuthGate>
                        <VerifyEmail />
                    </AuthGate>
                </WorkspaceProvider>
            </UserProvider>
        </MemoryRouter>
    )

beforeEach(() => {
    mockNavigate.mockClear()
    vi.mocked(axiosInstance.post).mockRejectedValue(new AxiosError('Network Error'))
    vi.mocked(axiosInstance.get).mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
    vi.clearAllMocks()
})

describe('VerifyEmail - no token, signed out', () => {
    it('renders the awaiting-verification panel with no resend button', () => {
        renderWithProviders(<VerifyEmail />, { route: '/verify-email' })

        expect(screen.getByText('Verify your email')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /resend verification email/i })).not.toBeInTheDocument()
    })
})

describe('VerifyEmail - no token, signed in', () => {
    it('renders the awaiting-verification panel with a resend button that calls the resend endpoint', async () => {
        vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
            if (url === API_PATHS.AUTH.REFRESH) return { success: true, data: { token: 'tok', user: mockUser } }
            if (url === API_PATHS.AUTH.EMAIL_VERIFICATION_RESEND) {
                return { success: true, data: { message: 'Verification email sent' } }
            }
            throw new AxiosError('Network Error')
        })
        const user = userEvent.setup()
        renderAuthenticated('/verify-email')

        await waitFor(() => expect(screen.getByText('Verify your email')).toBeInTheDocument())
        const resendButton = screen.getByRole('button', { name: /resend verification email/i })

        await user.click(resendButton)

        await waitFor(() =>
            expect(axiosInstance.post).toHaveBeenCalledWith(API_PATHS.AUTH.EMAIL_VERIFICATION_RESEND)
        )
    })
})

describe('VerifyEmail - no token, signed out, bounced from a blocked login (V9)', () => {
    it('shows the email and a resend button that calls the endpoint with { email }', async () => {
        vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
            if (url === API_PATHS.AUTH.EMAIL_VERIFICATION_RESEND) {
                return { success: true, data: { message: 'Verification email sent. Please check your inbox' } }
            }
            throw new AxiosError('Network Error')
        })
        const user = userEvent.setup()
        render(
            <MemoryRouter initialEntries={[{ pathname: '/verify-email', state: { email: 'blocked@example.com' } }]}>
                <UserProvider>
                    <VerifyEmail />
                </UserProvider>
            </MemoryRouter>
        )

        expect(screen.getByText(/blocked@example\.com/)).toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: /resend verification email/i }))

        await waitFor(() =>
            expect(axiosInstance.post).toHaveBeenCalledWith(API_PATHS.AUTH.EMAIL_VERIFICATION_RESEND, {
                email: 'blocked@example.com',
            })
        )
    })
})

describe('VerifyEmail - confirming with a token, signed out', () => {
    it('confirms the token and navigates to /login', async () => {
        vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
            if (url === API_PATHS.AUTH.EMAIL_VERIFICATION_CONFIRM) {
                return { success: true, data: { message: 'Email verified' } }
            }
            throw new AxiosError('Network Error')
        })
        renderWithProviders(<VerifyEmail />, { route: '/verify-email?token=good-token' })

        expect(screen.getByText('Verifying your email...')).toBeInTheDocument()

        await waitFor(() =>
            expect(axiosInstance.post).toHaveBeenCalledWith(API_PATHS.AUTH.EMAIL_VERIFICATION_CONFIRM, {
                token: 'good-token',
            })
        )
        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true }))
    })
})

describe('VerifyEmail - confirmation fails', () => {
    it('shows the failed state with the server error message and a link back to sign in', async () => {
        const rejection = new AxiosError('Request failed with status code 400')
        rejection.response = { status: 400, data: { success: false, message: 'This verification link has expired' } } as never

        vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
            if (url === API_PATHS.AUTH.EMAIL_VERIFICATION_CONFIRM) throw rejection
            throw new AxiosError('Network Error')
        })
        renderWithProviders(<VerifyEmail />, { route: '/verify-email?token=bad-token' })

        await waitFor(() => expect(screen.getByText('Verification failed')).toBeInTheDocument())
        expect(screen.getByText('This verification link has expired')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: /back to sign in/i })).toBeInTheDocument()
        expect(mockNavigate).not.toHaveBeenCalled()
    })
})
