import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, waitFor, userEvent } from '../../../test/test-utils'
import LegalGate from '../LegalGate'
import axiosInstance from '../../../utils/axiosInstance'
import { API_PATHS } from '../../../utils/apiPaths'
import type { User } from '../../../types/api'

/**
 * The consent gate (M0c). Two situations reach it: an account created before versioned consent
 * shipped, which has no `legalAcceptance` at all, and an account whose stored versions went stale
 * because a document was bumped in `backend/utils/legalVersions.ts`.
 *
 * The gate is deliberately not dismissible, so these specs assert that the dashboard behind it
 * genuinely does not render until acceptance is recorded.
 *
 * `useUser` is mocked rather than seeded through `renderWithProviders`, because `UserProvider`
 * fetches its own profile and there is no hook for injecting one.
 */

vi.mock('../../../utils/axiosInstance', () => ({
    default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const mockUpdateUser = vi.fn()
const mockLogout = vi.fn().mockResolvedValue(undefined)
const mockDeleteAccount = vi.fn().mockResolvedValue(undefined)
let currentUser: User | null = null

vi.mock('../../../hooks/useUser', () => ({
    useUser: () => ({
        user: currentUser,
        updateUser: mockUpdateUser,
        logout: mockLogout,
        deleteAccount: mockDeleteAccount,
    }),
}))

// SEC-48: the gate's own "Export my data" affordance. Its wiring is covered here; the export
// itself has its own tests.
const mockExportPersonalBackup = vi.fn().mockResolvedValue(undefined)
vi.mock('../../../utils/personalBackupExport', () => ({
    exportPersonalBackup: () => mockExportPersonalBackup(),
}))

const CURRENT = { termsVersion: '2026-08-29', privacyVersion: '2026-08-29' }

const baseUser: User = {
    _id: 'user1',
    fullName: 'Alex Kim',
    email: 'alex@example.com',
    legalVersions: CURRENT,
}

const accepted = {
    ...CURRENT,
    acceptedAt: '2026-08-29T00:00:00.000Z',
    ageAttested: true,
}

const renderGate = (user: User) => {
    currentUser = user
    return renderWithProviders(
        <LegalGate>
            <div>Dashboard content</div>
        </LegalGate>,
        { route: '/dashboard' }
    )
}

beforeEach(() => {
    vi.mocked(axiosInstance.post).mockResolvedValue({
        success: true,
        data: { ...baseUser, legalAcceptance: accepted },
    })
})

afterEach(() => {
    vi.clearAllMocks()
    currentUser = null
})

describe('LegalGate', () => {
    it('renders children when the stored acceptance matches the current versions', () => {
        renderGate({ ...baseUser, legalAcceptance: accepted })

        expect(screen.getByText('Dashboard content')).toBeInTheDocument()
    })

    it('blocks an account that has never accepted a versioned policy', () => {
        renderGate(baseUser)

        expect(screen.queryByText('Dashboard content')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: /i agree/i })).toBeInTheDocument()
    })

    it('blocks an account whose stored terms version has gone stale', () => {
        renderGate({ ...baseUser, legalAcceptance: { ...accepted, termsVersion: '2020-01-01' } })

        expect(screen.queryByText('Dashboard content')).not.toBeInTheDocument()
        expect(screen.getByText(/updated our terms/i)).toBeInTheDocument()
    })

    it('blocks an account whose stored privacy version has gone stale', () => {
        renderGate({ ...baseUser, legalAcceptance: { ...accepted, privacyVersion: '2020-01-01' } })

        expect(screen.queryByText('Dashboard content')).not.toBeInTheDocument()
    })

    it('links both documents so they can be read before accepting', () => {
        renderGate(baseUser)

        expect(screen.getByRole('link', { name: /terms of service/i })).toHaveAttribute('href', '/terms')
        expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', '/privacy')
    })

    it('records the acceptance through the API', async () => {
        const user = userEvent.setup()
        renderGate(baseUser)

        await user.click(screen.getByRole('button', { name: /i agree/i }))

        await waitFor(() =>
            expect(axiosInstance.post).toHaveBeenCalledWith(API_PATHS.AUTH.LEGAL_ACCEPT, {})
        )
        await waitFor(() =>
            expect(mockUpdateUser).toHaveBeenCalledWith(
                expect.objectContaining({ legalAcceptance: expect.objectContaining(CURRENT) })
            )
        )
    })

    it('surfaces sign-out, export and delete-account inside the gate (SEC-48)', () => {
        renderGate(baseUser)

        expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /export my data/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /delete my account/i })).toBeInTheDocument()
    })

    it('exports without requiring acceptance first (SEC-48)', async () => {
        const user = userEvent.setup()
        renderGate(baseUser)

        await user.click(screen.getByRole('button', { name: /export my data/i }))

        await waitFor(() => expect(mockExportPersonalBackup).toHaveBeenCalledOnce())
        expect(axiosInstance.post).not.toHaveBeenCalledWith(API_PATHS.AUTH.LEGAL_ACCEPT, {})
    })

    it('signs out without requiring acceptance first (SEC-48)', async () => {
        const user = userEvent.setup()
        renderGate(baseUser)

        await user.click(screen.getByRole('button', { name: /sign out/i }))

        await waitFor(() => expect(mockLogout).toHaveBeenCalledOnce())
    })

    it('does not gate before the profile has loaded', () => {
        // No `legalVersions` yet means the server payload has not arrived - showing a consent wall
        // here would flash on every page load.
        renderGate({ _id: 'user1', fullName: 'Alex Kim', email: 'alex@example.com' })

        expect(screen.getByText('Dashboard content')).toBeInTheDocument()
    })
})
