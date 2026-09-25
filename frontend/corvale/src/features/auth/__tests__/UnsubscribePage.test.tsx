import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AxiosError } from 'axios'
import { renderWithProviders, screen, waitFor, userEvent } from '@/test/test-utils'
import UnsubscribePage from '../UnsubscribePage'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'

// M9c: the win-back email's opt-out. Landing on the link must not unsubscribe by itself (mail
// scanners prefetch links); only the button does, and it posts the token from the URL.

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
})

afterEach(() => {
    vi.clearAllMocks()
})

describe('UnsubscribePage', () => {
    it('shows an invalid-link panel when there is no token', () => {
        renderWithProviders(<UnsubscribePage />, { route: '/unsubscribe' })

        expect(screen.getByText('Invalid unsubscribe link')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /unsubscribe/i })).not.toBeInTheDocument()
    })

    it('does not call the API until the button is pressed', () => {
        renderWithProviders(<UnsubscribePage />, { route: '/unsubscribe?token=abc.def' })

        expect(screen.getByRole('button', { name: /unsubscribe/i })).toBeInTheDocument()
        expect(axiosInstance.post).not.toHaveBeenCalled()
    })

    it('posts the token and confirms the opt-out', async () => {
        vi.mocked(axiosInstance.post).mockResolvedValue({ success: true, data: { message: 'Unsubscribed' } })
        const user = userEvent.setup()
        renderWithProviders(<UnsubscribePage />, { route: '/unsubscribe?token=abc.def' })

        await user.click(screen.getByRole('button', { name: /unsubscribe/i }))

        await waitFor(() =>
            expect(axiosInstance.post).toHaveBeenCalledWith(API_PATHS.AUTH.EMAIL_PREFERENCES_UNSUBSCRIBE, { token: 'abc.def' })
        )
        expect(await screen.findByText(/you.ve been unsubscribed/i)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /unsubscribe/i })).not.toBeInTheDocument()
    })

    it('shows the server error and keeps the button when the link is rejected', async () => {
        const rejection = new AxiosError('Request failed with status code 400')
        rejection.response = { status: 400, data: { success: false, message: 'Invalid unsubscribe link' } } as never
        vi.mocked(axiosInstance.post).mockRejectedValue(rejection)
        const user = userEvent.setup()
        renderWithProviders(<UnsubscribePage />, { route: '/unsubscribe?token=bad' })

        await user.click(screen.getByRole('button', { name: /unsubscribe/i }))

        expect(await screen.findByText('Invalid unsubscribe link')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /unsubscribe/i })).toBeInTheDocument()
    })
})
