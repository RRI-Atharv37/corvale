import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, waitFor, userEvent, fireEvent } from '../../../test/test-utils'
import ProfileSettings from '../ProfileSettings'
import axiosInstance from '../../../utils/axiosInstance'
import { API_PATHS } from '../../../utils/apiPaths'
import toast from 'react-hot-toast'
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

vi.mock('react-hot-toast', () => ({
    default: { error: vi.fn(), success: vi.fn() },
}))

const mockUser: User = {
    _id: 'user1',
    fullName: 'Jamie Rivera',
    email: 'jamie@example.com',
    timezone: 'America/New_York',
    preferredCurrency: 'USD',
}

// happy-dom (the project's test environment) does not reliably fire the implicit form submission a
// real browser produces on a submit-button click, so form submits go through `fireEvent.submit`.
const submitClosestForm = (element: HTMLElement): void => {
    const form = element.closest('form') ?? element.ownerDocument.querySelector('form')
    if (!form) throw new Error('No form found to submit')
    fireEvent.submit(form)
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

describe('ProfileSettings', () => {
    it('renders the current full name and the auto-detected timezone as read-only text (V5)', async () => {
        renderWithProviders(<ProfileSettings />)

        await waitFor(() =>
            expect(screen.getByLabelText(/full name/i)).toHaveValue('Jamie Rivera')
        )

        // No picker any more - the timezone is shown, not chosen.
        expect(screen.queryByRole('combobox', { name: /timezone/i })).not.toBeInTheDocument()
        expect(screen.getByText('America/New_York')).toBeInTheDocument()
        expect(screen.getByText(/detected automatically from your device/i)).toBeInTheDocument()
    })

    it('saves an updated full name without sending a timezone', async () => {
        vi.mocked(axiosInstance.patch).mockResolvedValue({
            success: true,
            data: { ...mockUser, fullName: 'Jamie R. Rivera' },
        })

        renderWithProviders(<ProfileSettings />)
        await waitFor(() => expect(screen.getByLabelText(/full name/i)).toHaveValue('Jamie Rivera'))

        const user = userEvent.setup()
        const nameInput = screen.getByLabelText(/full name/i)
        await user.clear(nameInput)
        await user.type(nameInput, 'Jamie R. Rivera')

        submitClosestForm(screen.getByRole('button', { name: /save profile/i }))

        await waitFor(() =>
            expect(axiosInstance.patch).toHaveBeenCalledWith(API_PATHS.AUTH.UPDATE_USER, {
                fullName: 'Jamie R. Rivera',
            })
        )
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Profile updated'))
    })

    it('rejects an empty full name without calling the API', async () => {
        renderWithProviders(<ProfileSettings />)
        await waitFor(() => expect(screen.getByLabelText(/full name/i)).toHaveValue('Jamie Rivera'))

        const user = userEvent.setup()
        const nameInput = screen.getByLabelText(/full name/i)
        await user.clear(nameInput)

        submitClosestForm(screen.getByRole('button', { name: /save profile/i }))

        await waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/full name is required/i))
        )
        expect(axiosInstance.patch).not.toHaveBeenCalled()
    })

    it('disables the save button until a field actually changes', async () => {
        renderWithProviders(<ProfileSettings />)
        await waitFor(() => expect(screen.getByLabelText(/full name/i)).toHaveValue('Jamie Rivera'))

        expect(screen.getByRole('button', { name: /save profile/i })).toBeDisabled()

        const user = userEvent.setup()
        await user.type(screen.getByLabelText(/full name/i), '!')

        expect(screen.getByRole('button', { name: /save profile/i })).toBeEnabled()
    })
})
