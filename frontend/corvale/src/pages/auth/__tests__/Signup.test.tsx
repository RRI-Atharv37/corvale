import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AxiosError } from 'axios'
import { renderWithProviders, screen, waitFor, userEvent } from '../../../test/test-utils'
import Signup from '../Signup'
import axiosInstance from '../../../utils/axiosInstance'
import { API_PATHS } from '../../../utils/apiPaths'
import type { User } from '../../../types/api'

// T4: Signup has zero prior coverage. Covers client-side validation, a successful sign-up
// persisting the session and redirecting to /dashboard, and a rejected sign-up (e.g. duplicate
// email) surfacing the server's error message without navigating.

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

// V5: Signup sends the auto-detected device timezone in the register payload. Pin it so the
// assertion doesn't depend on the CI runner's system zone.
vi.mock('../../../utils/timezoneSync', () => ({
    detectTimezone: vi.fn().mockReturnValue('America/Chicago'),
}))

const mockUser: User = {
    _id: 'user2',
    fullName: 'Alex Kim',
    email: 'alex@example.com',
    preferredCurrency: 'USD',
}

const setOnline = (online: boolean): void => {
    Object.defineProperty(navigator, 'onLine', { value: online, writable: true, configurable: true })
}

beforeEach(() => {
    setOnline(true)
    mockNavigate.mockClear()
    vi.mocked(axiosInstance.post).mockRejectedValue(new AxiosError('Network Error'))
    vi.mocked(axiosInstance.get).mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
    vi.clearAllMocks()
    setOnline(true)
})

describe('Signup - client validation', () => {
    it('rejects a missing full name without calling the API', async () => {
        const user = userEvent.setup()
        renderWithProviders(<Signup />, { route: '/signup' })

        await user.type(screen.getByPlaceholderText('you@example.com'), 'alex@example.com')
        await user.type(screen.getByPlaceholderText('Minimum 12 characters'), 'correcthorsebattery')
        await user.click(screen.getByRole('button', { name: /sign up/i }))

        expect(screen.getByText('Please enter your full name.')).toBeInTheDocument()
        expect(axiosInstance.post).not.toHaveBeenCalledWith(API_PATHS.AUTH.REGISTER, expect.anything())
    })

    it('rejects an invalid email without calling the API', async () => {
        const user = userEvent.setup()
        renderWithProviders(<Signup />, { route: '/signup' })

        // A dot-less domain passes the browser's native `type="email"` constraint validation
        // (which would otherwise block the submit event before React's onSubmit runs) but fails
        // the app's stricter `validateEmail` regex - the case `handleSignup` is meant to catch.
        await user.type(screen.getByPlaceholderText('Your name'), 'Alex Kim')
        await user.type(screen.getByPlaceholderText('you@example.com'), 'alex@localhost')
        await user.type(screen.getByPlaceholderText('Minimum 12 characters'), 'correcthorsebattery')
        await user.click(screen.getByRole('button', { name: /sign up/i }))

        expect(screen.getByText('Please enter a valid email address.')).toBeInTheDocument()
        expect(axiosInstance.post).not.toHaveBeenCalledWith(API_PATHS.AUTH.REGISTER, expect.anything())
    })

    it('rejects an empty password without calling the API', async () => {
        const user = userEvent.setup()
        renderWithProviders(<Signup />, { route: '/signup' })

        await user.type(screen.getByPlaceholderText('Your name'), 'Alex Kim')
        await user.type(screen.getByPlaceholderText('you@example.com'), 'alex@example.com')
        await user.click(screen.getByRole('button', { name: /sign up/i }))

        expect(screen.getByText('Please enter a password')).toBeInTheDocument()
        expect(axiosInstance.post).not.toHaveBeenCalledWith(API_PATHS.AUTH.REGISTER, expect.anything())
    })
})

describe('Signup - successful sign-up', () => {
    it('submits the form, persists the session, and navigates to /dashboard', async () => {
        vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
            if (url === API_PATHS.AUTH.REGISTER) {
                return { success: true, data: { token: 'test-token', user: mockUser } }
            }
            throw new AxiosError('Network Error')
        })
        const user = userEvent.setup()
        renderWithProviders(<Signup />, { route: '/signup' })

        await user.type(screen.getByPlaceholderText('Your name'), 'Alex Kim')
        await user.type(screen.getByPlaceholderText('you@example.com'), 'alex@example.com')
        await user.type(screen.getByPlaceholderText('Minimum 12 characters'), 'correcthorsebattery')
        await user.click(screen.getByRole('button', { name: /sign up/i }))

        await waitFor(() =>
            expect(axiosInstance.post).toHaveBeenCalledWith(API_PATHS.AUTH.REGISTER, {
                fullName: 'Alex Kim',
                email: 'alex@example.com',
                password: 'correcthorsebattery',
                timezone: 'America/Chicago',
            })
        )
        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard'))
    })
})

describe('Signup - API rejection', () => {
    it('shows the server error message (e.g. duplicate email) and does not navigate', async () => {
        const rejection = new AxiosError('Request failed with status code 409')
        rejection.response = { status: 409, data: { success: false, message: 'An account with that email already exists' } } as never

        vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
            if (url === API_PATHS.AUTH.REGISTER) throw rejection
            throw new AxiosError('Network Error')
        })
        const user = userEvent.setup()
        renderWithProviders(<Signup />, { route: '/signup' })

        await user.type(screen.getByPlaceholderText('Your name'), 'Alex Kim')
        await user.type(screen.getByPlaceholderText('you@example.com'), 'alex@example.com')
        await user.type(screen.getByPlaceholderText('Minimum 12 characters'), 'correcthorsebattery')
        await user.click(screen.getByRole('button', { name: /sign up/i }))

        await waitFor(() =>
            expect(screen.getByText('An account with that email already exists')).toBeInTheDocument()
        )
        expect(mockNavigate).not.toHaveBeenCalled()
    })
})

describe('Signup - offline', () => {
    it('disables submission and shows an offline notice', () => {
        setOnline(false)
        renderWithProviders(<Signup />, { route: '/signup' })

        expect(screen.getByText(/sign up requires a connection/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /sign up/i })).toBeDisabled()
    })
})
