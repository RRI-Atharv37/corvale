import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, render, screen, waitFor, userEvent } from '../../test/test-utils'
import { useUser } from '../../hooks/useUser'
import ProtectedRoute from '../../routes/ProtectedRoute'
import axiosInstance from '../../utils/axiosInstance'
import { getCachedUser, setCachedUser } from '../cachedUser'
import { wipeLocalData } from '../wipeLocalData'
import PinUnlock from '../PinUnlock'
import { clearOfflineGrant, storeOfflineGrant } from '../offlineGrant'
import { createTestOfflineGrant } from '../../test/offlineGrantFixture'
import { handleTokenRevoked } from '../tokenRevokedFlow'
import type { User } from '../../types/api'

// Design decisions (modules under `../` do not exist yet - Sprint 13.7):
// - `getCachedUser`/`setCachedUser` are assumed to be backed by the same durable
//   storage the boot flow reads on startup (localStorage today, the local SQLite
//   `User` row eventually). Tests only rely on the get/set contract.
// - `wipeLocalData` is mocked via `vi.mock` so we can assert it was *called*, not that
//   it actually deletes anything (its own implementation is a later sprint's concern).
// - `PinUnlock` is assumed to accept `verifyPin(pin): boolean | Promise<boolean>` and
//   `onUnlocked()` props, label its input "PIN", and expose an "Unlock" button.
// - Lockout policy: 5 consecutive wrong attempts locks the input and shows a
//   "too many attempts" message. The architecture doc left the exact threshold
//   unspecified; 5 mirrors common mobile-OS PIN policies - reconcile with 13.7.
// - `handleTokenRevoked` is an assumed new module (`../tokenRevokedFlow`) that
//   sequences "offer export" before "wipe" - the architecture doc describes the
//   *behavior* but not a concrete function shape, so this is invented to make the
//   ordering guarantee independently testable from any UI.
// - S16/SEC-18: the plain `sessionValidUntil` date is gone. Offline rendering of a
//   cached user is now gated on `verifyOfflineGrant` (see `offlineGrant.test.ts` for its
//   own unit coverage) - these boot tests seed a real signed grant via
//   `createTestOfflineGrant` to exercise the happy path, and a dedicated block below
//   covers the fail-closed case where no valid grant is present.

vi.mock('../../utils/axiosInstance', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        patch: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
    },
}))

vi.mock('../wipeLocalData', () => ({
    wipeLocalData: vi.fn(async () => ({ pinCleared: false })),
}))

const setOnline = (online: boolean): void => {
    Object.defineProperty(navigator, 'onLine', { value: online, writable: true, configurable: true })
}

const mockUser: User = {
    _id: 'user1',
    fullName: 'Jamie Rivera',
    email: 'jamie@example.com',
}

afterEach(() => {
    vi.clearAllMocks()
    setOnline(true)
})

describe('offline boot: cached user rendering', () => {
    const DashboardProbe = () => {
        const { user, isInitializing, isAuthenticated } = useUser()
        if (isInitializing) return <div data-testid="init">Initializing</div>
        return (
            <div data-testid="dashboard">{isAuthenticated ? `Welcome ${user?.fullName}` : 'no-auth'}</div>
        )
    }

    beforeEach(async () => {
        setCachedUser(mockUser)
        await storeOfflineGrant(await createTestOfflineGrant(mockUser._id))
        setOnline(false)
        vi.mocked(axiosInstance.get).mockRejectedValue(new Error('Network Error'))
        vi.mocked(axiosInstance.post).mockRejectedValue(new Error('Network Error'))
    })

    it('renders the cached user immediately instead of hanging on a spinner', async () => {
        renderWithProviders(
            <ProtectedRoute>
                <DashboardProbe />
            </ProtectedRoute>,
            { route: '/dashboard', withWorkspace: false }
        )

        await waitFor(() => {
            expect(screen.getByTestId('dashboard')).toBeInTheDocument()
        })

        expect(screen.getByTestId('dashboard')).toHaveTextContent(`Welcome ${mockUser.fullName}`)
    })

    it('does not redirect away from the protected route while offline with a cached user', async () => {
        renderWithProviders(
            <ProtectedRoute>
                <DashboardProbe />
            </ProtectedRoute>,
            { route: '/dashboard', withWorkspace: false }
        )

        await waitFor(() => {
            expect(screen.getByTestId('dashboard')).toBeInTheDocument()
        })

        expect(screen.queryByText('no-auth')).not.toBeInTheDocument()
    })

    it('getCachedUser returns what was cached via setCachedUser', () => {
        expect(getCachedUser()).toEqual(mockUser)
    })
})

describe('offline boot: fails closed without a valid offline grant', () => {
    const DashboardProbe = () => {
        const { isInitializing, isAuthenticated } = useUser()
        if (isInitializing) return <div data-testid="init">Initializing</div>
        return <div data-testid="dashboard">{isAuthenticated ? 'authenticated' : 'no-auth'}</div>
    }

    beforeEach(() => {
        setCachedUser(mockUser)
        setOnline(false)
        vi.mocked(axiosInstance.get).mockRejectedValue(new Error('Network Error'))
        vi.mocked(axiosInstance.post).mockRejectedValue(new Error('Network Error'))
    })

    it('does not authenticate from a cached user when no offline grant was ever stored', async () => {
        clearOfflineGrant()

        renderWithProviders(<DashboardProbe />, { withWorkspace: false })

        await waitFor(() => expect(screen.queryByTestId('init')).not.toBeInTheDocument())
        expect(screen.getByTestId('dashboard')).toHaveTextContent('no-auth')
    })

    it('does not authenticate from a cached user when the stored grant has expired', async () => {
        await storeOfflineGrant(await createTestOfflineGrant(mockUser._id, { expiresInSeconds: -60 }))

        renderWithProviders(<DashboardProbe />, { withWorkspace: false })

        await waitFor(() => expect(screen.queryByTestId('init')).not.toBeInTheDocument())
        expect(screen.getByTestId('dashboard')).toHaveTextContent('no-auth')
    })

    it('does not authenticate from a cached user when the stored grant belongs to a different user', async () => {
        await storeOfflineGrant(await createTestOfflineGrant('someone-else'))

        renderWithProviders(<DashboardProbe />, { withWorkspace: false })

        await waitFor(() => expect(screen.queryByTestId('init')).not.toBeInTheDocument())
        expect(screen.getByTestId('dashboard')).toHaveTextContent('no-auth')
    })
})

describe('PinUnlock gate', () => {
    const FinancialSecret = () => <div data-testid="secret">Balance: $42,000</div>

    const renderGate = (verifyPin = vi.fn(async (pin: string) => pin === '1234')) => {
        const onUnlocked = vi.fn()
        render(
            <PinUnlock verifyPin={verifyPin} onUnlocked={onUnlocked}>
                <FinancialSecret />
            </PinUnlock>
        )
        return { verifyPin, onUnlocked }
    }

    it('hides financial data behind the lock screen by default', () => {
        renderGate()

        expect(screen.queryByTestId('secret')).not.toBeInTheDocument()
        expect(screen.getByLabelText(/pin/i)).toBeInTheDocument()
    })

    it('reveals children once the correct PIN is entered', async () => {
        const user = userEvent.setup()
        const { onUnlocked } = renderGate()

        await user.type(screen.getByLabelText(/pin/i), '1234')
        await user.click(screen.getByRole('button', { name: /unlock/i }))

        await waitFor(() => expect(screen.getByTestId('secret')).toBeInTheDocument())
        expect(onUnlocked).toHaveBeenCalledTimes(1)
    })

    it('stays locked and shows an error on a wrong PIN', async () => {
        const user = userEvent.setup()
        renderGate()

        await user.type(screen.getByLabelText(/pin/i), '0000')
        await user.click(screen.getByRole('button', { name: /unlock/i }))

        await waitFor(() => expect(screen.getByText(/incorrect pin/i)).toBeInTheDocument())
        expect(screen.queryByTestId('secret')).not.toBeInTheDocument()
    })

    it('locks out further attempts after repeated wrong PINs', async () => {
        const user = userEvent.setup()
        renderGate()

        for (let attempt = 0; attempt < 5; attempt += 1) {
            await user.clear(screen.getByLabelText(/pin/i))
            await user.type(screen.getByLabelText(/pin/i), '9999')
            await user.click(screen.getByRole('button', { name: /unlock/i }))
        }

        await waitFor(() => expect(screen.getByText(/too many attempts/i)).toBeInTheDocument())
        expect(screen.getByLabelText(/pin/i)).toBeDisabled()
    })
})

describe('logout while offline', () => {
    const LogoutProbe = () => {
        const { logout } = useUser()
        return <button onClick={() => void logout()}>Log out</button>
    }

    beforeEach(() => {
        setOnline(false)
        vi.mocked(axiosInstance.get).mockResolvedValue({ success: true, data: mockUser })
        vi.mocked(axiosInstance.post).mockRejectedValue(new Error('Network Error'))
    })

    it('wipes local data when the user logs out with no network', async () => {
        const user = userEvent.setup()
        renderWithProviders(<LogoutProbe />, { withWorkspace: false })

        await user.click(screen.getByRole('button', { name: /log out/i }))

        await waitFor(() => expect(wipeLocalData).toHaveBeenCalledTimes(1))
    })
})

describe('TOKEN_REVOKED on reconnect', () => {
    it('offers an export before wiping when there are unsynced changes', async () => {
        const wipe = vi.fn(async () => {})
        const onExportOffer = vi.fn(async () => true)

        await handleTokenRevoked({ hasUnsyncedChanges: true, onExportOffer, wipe })

        expect(onExportOffer).toHaveBeenCalledTimes(1)
        expect(wipe).toHaveBeenCalledTimes(1)
        expect(onExportOffer.mock.invocationCallOrder[0]).toBeLessThan(wipe.mock.invocationCallOrder[0])
    })

    it('does not wipe until the export offer has been resolved', async () => {
        const wipe = vi.fn(async () => {})
        let resolveOffer: (exported: boolean) => void = () => {}
        const onExportOffer = vi.fn(
            () =>
                new Promise<boolean>((resolve) => {
                    resolveOffer = resolve
                })
        )

        const flow = handleTokenRevoked({ hasUnsyncedChanges: true, onExportOffer, wipe })

        expect(wipe).not.toHaveBeenCalled()

        resolveOffer(false)
        await flow

        expect(wipe).toHaveBeenCalledTimes(1)
    })

    it('wipes without offering an export when there are no unsynced changes', async () => {
        const wipe = vi.fn(async () => {})
        const onExportOffer = vi.fn(async () => true)

        await handleTokenRevoked({ hasUnsyncedChanges: false, onExportOffer, wipe })

        expect(onExportOffer).not.toHaveBeenCalled()
        expect(wipe).toHaveBeenCalledTimes(1)
    })
})

// Offline-grant expiry/tamper/wrong-user coverage lives in `offlineGrant.test.ts` next to the
// module itself (S16, SEC-18) - superseded the old `sessionPolicy: isLocalSessionValid` block
// that tested a plain, forgeable expiry date.
