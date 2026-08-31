import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, waitFor } from '../../test/test-utils'
import { useUser } from '../../hooks/useUser'
import axiosInstance from '../../utils/axiosInstance'
import { SESSION_EXPIRED_EVENT } from '../../utils/sessionEvents'
import { TOKEN_REVOKED_EVENT } from '../../offline/tokenRevokedFlow'
import { API_PATHS } from '../../utils/apiPaths'
import toast from 'react-hot-toast'
import type { User } from '../../types/api'

// X1/BUG-07: dispatching SESSION_EXPIRED_EVENT (as axiosInstance's response interceptor now
// does on any session-ending 401 - see axiosInstance.test.ts) must clear UserContext's user so
// ProtectedRoute stops rendering a stale authenticated shell, and must surface a notice so the
// sign-out isn't silent.

vi.mock('../../utils/axiosInstance', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
    },
}))

vi.mock('react-hot-toast', () => ({
    default: { error: vi.fn(), success: vi.fn() },
}))

// SEC-38: an involuntary logout (session expiry, boot refresh rejection) must clear the local
// store, not just the in-memory session.
const wipeLocalDataMock = vi.fn(async () => ({ pinCleared: false }))
vi.mock('../../offline/wipeLocalData', () => ({ wipeLocalData: () => wipeLocalDataMock() }))
vi.mock('../../offline/exportUnsyncedOps', () => ({ exportUnsyncedOps: vi.fn(async () => {}) }))
vi.mock('../../sync/syncEngine', () => ({ getSyncStatus: vi.fn(async () => ({ pendingCount: 0 })) }))
vi.mock('../../db/provisionLocalDb', () => ({ provisionLocalDb: vi.fn(async () => {}) }))

// SEC-11 / BUG-24: the desktop keychain-held refresh token. Inert on the web; here we assert
// UserContext drives it (persist on restore, wipe on clear).
const { getStoredRefreshTokenMock, storeRefreshTokenMock, clearStoredRefreshTokenMock } = vi.hoisted(() => ({
    getStoredRefreshTokenMock: vi.fn(),
    storeRefreshTokenMock: vi.fn(),
    clearStoredRefreshTokenMock: vi.fn(),
}))
vi.mock('../../utils/refreshTokenStore', () => ({
    getStoredRefreshToken: getStoredRefreshTokenMock,
    storeRefreshToken: storeRefreshTokenMock,
    clearStoredRefreshToken: clearStoredRefreshTokenMock,
}))

const mockUser: User = {
    _id: 'user1',
    fullName: 'Jamie Rivera',
    email: 'jamie@example.com',
}

const UserProbe = () => {
    const { user, isAuthenticated, isInitializing } = useUser()
    if (isInitializing) return <div data-testid="init">Initializing</div>
    return <div data-testid="probe">{isAuthenticated ? `authed:${user?.fullName}` : 'guest'}</div>
}

beforeEach(() => {
    wipeLocalDataMock.mockClear()
    getStoredRefreshTokenMock.mockReset()
    getStoredRefreshTokenMock.mockResolvedValue(null)
    storeRefreshTokenMock.mockReset()
    storeRefreshTokenMock.mockResolvedValue(undefined)
    clearStoredRefreshTokenMock.mockReset()
    clearStoredRefreshTokenMock.mockResolvedValue(undefined)
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

describe('UserContext - SESSION_EXPIRED_EVENT (BUG-07)', () => {
    it('clears the signed-in user and shows a session-expired notice when the event fires', async () => {
        renderWithProviders(<UserProbe />, { withWorkspace: false })

        await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('authed:Jamie Rivera'))

        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))

        await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('guest'))
        expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/session.*expired/i))
    })

    it('does nothing to an already-guest session beyond the (idempotent) notice', async () => {
        vi.mocked(axiosInstance.post).mockRejectedValue(new Error('no session'))
        renderWithProviders(<UserProbe />, { withWorkspace: false })

        await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('guest'))

        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))

        await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('guest'))
    })
})

describe('UserContext - local store wipe on involuntary logout (SEC-38)', () => {
    it('wipes the local store when the session expires', async () => {
        renderWithProviders(<UserProbe />, { withWorkspace: false })
        await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('authed:Jamie Rivera'))

        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))

        await waitFor(() => expect(wipeLocalDataMock).toHaveBeenCalledTimes(1))
    })

    it('wipes the local store when the boot refresh is rejected (no valid session)', async () => {
        vi.mocked(axiosInstance.post).mockRejectedValue({
            response: { status: 401, data: { message: 'refresh token expired' } },
        })

        renderWithProviders(<UserProbe />, { withWorkspace: false })

        await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('guest'))
        await waitFor(() => expect(wipeLocalDataMock).toHaveBeenCalled())
    })

    it('does not start a second wipe when the TOKEN_REVOKED flow is already handling it', async () => {
        renderWithProviders(<UserProbe />, { withWorkspace: false })
        await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('authed:Jamie Rivera'))

        // axiosInstance fires both events for a revocation; the revoked flow owns the wipe.
        window.dispatchEvent(new Event(TOKEN_REVOKED_EVENT))
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))

        await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('guest'))
        await waitFor(() => expect(wipeLocalDataMock).toHaveBeenCalledTimes(1))
    })
})

describe('UserContext - desktop refresh token (SEC-11 / BUG-24)', () => {
    it('sends the stored refresh token on restore and persists the rotated one', async () => {
        getStoredRefreshTokenMock.mockResolvedValue('keychain-rt')
        vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
            if (url === API_PATHS.AUTH.REFRESH) {
                return {
                    success: true,
                    data: { token: 'test-token', user: mockUser, offlineGrant: null, refreshToken: 'rotated-rt' },
                }
            }
            throw new Error('unused in this suite')
        })

        renderWithProviders(<UserProbe />, { withWorkspace: false })

        await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('authed:Jamie Rivera'))

        expect(axiosInstance.post).toHaveBeenCalledWith(API_PATHS.AUTH.REFRESH, { refreshToken: 'keychain-rt' })
        expect(storeRefreshTokenMock).toHaveBeenCalledWith('rotated-rt')
    })

    it('wipes the stored refresh token when the session is cleared', async () => {
        renderWithProviders(<UserProbe />, { withWorkspace: false })

        await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('authed:Jamie Rivera'))

        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))

        await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('guest'))
        expect(clearStoredRefreshTokenMock).toHaveBeenCalled()
    })
})
