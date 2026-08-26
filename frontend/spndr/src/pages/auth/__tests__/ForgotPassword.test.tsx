import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AxiosError } from 'axios'
import { renderWithProviders, screen, waitFor, userEvent } from '../../../test/test-utils'
import ForgotPassword from '../ForgotPassword'
import axiosInstance from '../../../utils/axiosInstance'
import { API_PATHS } from '../../../utils/apiPaths'

// T4: ForgotPassword had zero prior coverage. Covers client validation, a successful request
// swapping to the confirmation panel, and a rejected request keeping the form visible with an
// inline error.

vi.mock('../../../utils/axiosInstance', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
    },
}))

const setOnline = (online: boolean): void => {
    Object.defineProperty(navigator, 'onLine', { value: online, writable: true, configurable: true })
}

beforeEach(() => {
    setOnline(true)
    vi.mocked(axiosInstance.post).mockRejectedValue(new AxiosError('Network Error'))
    vi.mocked(axiosInstance.get).mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
    vi.clearAllMocks()
    setOnline(true)
})

describe('ForgotPassword - client validation', () => {
    it('rejects an invalid email without calling the API', async () => {
        const user = userEvent.setup()
        renderWithProviders(<ForgotPassword />, { route: '/forgot-password' })

        // A dot-less domain passes the browser's native `type="email"` constraint validation
        // (which would otherwise block the submit event before React's onSubmit runs) but fails
        // the app's stricter `validateEmail` regex - the case `handleSubmit` is meant to catch.
        await user.type(screen.getByPlaceholderText('you@example.com'), 'jamie@localhost')
        await user.click(screen.getByRole('button', { name: /send reset link/i }))

        expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument()
        expect(axiosInstance.post).not.toHaveBeenCalledWith(
            API_PATHS.AUTH.PASSWORD_RESET_REQUEST,
            expect.anything()
        )
    })
})

describe('ForgotPassword - successful request', () => {
    it('submits the email and shows the confirmation panel', async () => {
        vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
            if (url === API_PATHS.AUTH.PASSWORD_RESET_REQUEST) {
                return { success: true, data: { message: 'If an account exists, a reset link was sent.' } }
            }
            throw new AxiosError('Network Error')
        })
        const user = userEvent.setup()
        renderWithProviders(<ForgotPassword />, { route: '/forgot-password' })

        await user.type(screen.getByPlaceholderText('you@example.com'), 'jamie@example.com')
        await user.click(screen.getByRole('button', { name: /send reset link/i }))

        await waitFor(() =>
            expect(axiosInstance.post).toHaveBeenCalledWith(API_PATHS.AUTH.PASSWORD_RESET_REQUEST, {
                email: 'jamie@example.com',
            })
        )
        expect(
            await screen.findByText(/if an account exists for that email, a password reset link has been sent/i)
        ).toBeInTheDocument()
        expect(screen.queryByPlaceholderText('you@example.com')).not.toBeInTheDocument()
    })
})

describe('ForgotPassword - API rejection', () => {
    it('shows the server error message and keeps the form visible', async () => {
        const rejection = new AxiosError('Request failed with status code 429')
        rejection.response = { status: 429, data: { success: false, message: 'Too many requests. Try again later.' } } as never

        vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
            if (url === API_PATHS.AUTH.PASSWORD_RESET_REQUEST) throw rejection
            throw new AxiosError('Network Error')
        })
        const user = userEvent.setup()
        renderWithProviders(<ForgotPassword />, { route: '/forgot-password' })

        await user.type(screen.getByPlaceholderText('you@example.com'), 'jamie@example.com')
        await user.click(screen.getByRole('button', { name: /send reset link/i }))

        await waitFor(() =>
            expect(screen.getByText('Too many requests. Try again later.')).toBeInTheDocument()
        )
        expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument()
    })
})

describe('ForgotPassword - offline', () => {
    it('disables submission while offline', () => {
        setOnline(false)
        renderWithProviders(<ForgotPassword />, { route: '/forgot-password' })

        expect(screen.getByRole('button', { name: /send reset link/i })).toBeDisabled()
    })
})
