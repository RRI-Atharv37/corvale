import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AxiosError } from 'axios'
import { renderWithProviders, screen, waitFor, userEvent } from '../../../test/test-utils'
import ResetPassword from '../ResetPassword'
import axiosInstance from '../../../utils/axiosInstance'
import { API_PATHS } from '../../../utils/apiPaths'

// T4: ResetPassword had zero prior coverage. Covers the missing-token invalid-link panel, client
// validation, a successful reset navigating to /login, and a rejected reset (expired link)
// keeping the form visible with an inline error.

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

describe('ResetPassword - missing token', () => {
    it('renders the invalid-link panel and does not render the form', () => {
        renderWithProviders(<ResetPassword />, { route: '/reset-password' })

        expect(screen.getByText('Invalid reset link')).toBeInTheDocument()
        expect(screen.queryByPlaceholderText('Minimum 12 characters')).not.toBeInTheDocument()
    })
})

describe('ResetPassword - client validation', () => {
    it('rejects a password under 12 characters without calling the API', async () => {
        const user = userEvent.setup()
        renderWithProviders(<ResetPassword />, { route: '/reset-password?token=abc123' })

        await user.type(screen.getByPlaceholderText('Minimum 12 characters'), 'short')
        await user.type(screen.getByPlaceholderText('Re-enter your password'), 'short')
        await user.click(screen.getByRole('button', { name: /reset password/i }))

        expect(screen.getByText('Password must be at least 12 characters')).toBeInTheDocument()
        expect(axiosInstance.post).not.toHaveBeenCalledWith(
            API_PATHS.AUTH.PASSWORD_RESET_CONFIRM,
            expect.anything()
        )
    })

    it('rejects mismatched passwords without calling the API', async () => {
        const user = userEvent.setup()
        renderWithProviders(<ResetPassword />, { route: '/reset-password?token=abc123' })

        await user.type(screen.getByPlaceholderText('Minimum 12 characters'), 'correcthorsebattery')
        await user.type(screen.getByPlaceholderText('Re-enter your password'), 'differenthorsebattery')
        await user.click(screen.getByRole('button', { name: /reset password/i }))

        expect(screen.getByText('Passwords do not match')).toBeInTheDocument()
        expect(axiosInstance.post).not.toHaveBeenCalledWith(
            API_PATHS.AUTH.PASSWORD_RESET_CONFIRM,
            expect.anything()
        )
    })
})

describe('ResetPassword - successful reset', () => {
    it('submits the token and new password, then navigates to /login', async () => {
        vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
            if (url === API_PATHS.AUTH.PASSWORD_RESET_CONFIRM) {
                return { success: true, data: { message: 'Password reset successful' } }
            }
            throw new AxiosError('Network Error')
        })
        const user = userEvent.setup()
        renderWithProviders(<ResetPassword />, { route: '/reset-password?token=abc123' })

        await user.type(screen.getByPlaceholderText('Minimum 12 characters'), 'correcthorsebattery')
        await user.type(screen.getByPlaceholderText('Re-enter your password'), 'correcthorsebattery')
        await user.click(screen.getByRole('button', { name: /reset password/i }))

        await waitFor(() =>
            expect(axiosInstance.post).toHaveBeenCalledWith(API_PATHS.AUTH.PASSWORD_RESET_CONFIRM, {
                token: 'abc123',
                password: 'correcthorsebattery',
            })
        )
        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true }))
    })
})

describe('ResetPassword - API rejection', () => {
    it('shows the server error message (expired link) and does not navigate', async () => {
        const rejection = new AxiosError('Request failed with status code 400')
        rejection.response = { status: 400, data: { success: false, message: 'This reset link has expired' } } as never

        vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
            if (url === API_PATHS.AUTH.PASSWORD_RESET_CONFIRM) throw rejection
            throw new AxiosError('Network Error')
        })
        const user = userEvent.setup()
        renderWithProviders(<ResetPassword />, { route: '/reset-password?token=expired-token' })

        await user.type(screen.getByPlaceholderText('Minimum 12 characters'), 'correcthorsebattery')
        await user.type(screen.getByPlaceholderText('Re-enter your password'), 'correcthorsebattery')
        await user.click(screen.getByRole('button', { name: /reset password/i }))

        await waitFor(() => expect(screen.getByText('This reset link has expired')).toBeInTheDocument())
        expect(mockNavigate).not.toHaveBeenCalled()
    })
})
