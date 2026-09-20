import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders, screen, waitFor, act } from '@/test/test-utils'

import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import type { EntitlementSnapshot, User } from '@lib/types/api'
import { getCachedUser, setCachedUser } from '@platform/offline/cachedUser'
import { useUser } from '../useUser'
import { useEntitlements } from '../useEntitlements'

/**
 * M2d - the entitlement snapshot is cached with the user, so an offline boot (which restores the
 * cached user only when the signed offline grant verifies) gets the last-known entitlements. A
 * missing snapshot must leave the user signed in and read-only - never locked out.
 */

vi.mock('@lib/axiosInstance', () => ({
    default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@platform/offline/wipeLocalData', () => ({ wipeLocalData: vi.fn(async () => ({ pinCleared: false })) }))
vi.mock('@platform/offline/exportUnsyncedOps', () => ({ exportUnsyncedOps: vi.fn(async () => {}) }))
vi.mock('@platform/sync/syncEngine', () => ({ getSyncStatus: vi.fn(async () => ({ pendingCount: 0 })) }))
vi.mock('@platform/db/provisionLocalDb', () => ({ provisionLocalDb: vi.fn(async () => {}) }))
vi.mock('@lib/refreshTokenStore', () => ({
    getStoredRefreshToken: vi.fn(async () => null),
    storeRefreshToken: vi.fn(async () => {}),
    clearStoredRefreshToken: vi.fn(async () => {}),
}))

const { verifyOfflineGrantMock } = vi.hoisted(() => ({ verifyOfflineGrantMock: vi.fn() }))
vi.mock('@lib/offlineGrant', () => ({
    verifyOfflineGrant: verifyOfflineGrantMock,
    getStoredOfflineGrant: vi.fn(() => 'grant'),
    storeOfflineGrant: vi.fn(),
    clearOfflineGrant: vi.fn(),
}))

const NOW = new Date().toISOString()

const activeSnapshot = (overrides: Partial<EntitlementSnapshot> = {}): EntitlementSnapshot => ({
    billingEnabled: true,
    status: 'active',
    planCode: 'pro',
    canRead: true,
    canWrite: true,
    canExport: true,
    canSyncPull: true,
    canSyncPush: true,
    features: { workspaces: true, prioritySupport: true, bankSync: true },
    limits: { receiptStorageBytes: 1000, syncDevices: null, workspaceMembers: 3 },
    trialEndsAt: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    graceEndsAt: null,
    resolvedAt: NOW,
    writableUntil: null,
    ...overrides,
})

const baseUser: User = { _id: 'user1', fullName: 'Jamie Rivera', email: 'jamie@example.com' }

let updateUserRef: ((u: User) => void) | null = null

const Probe = () => {
    const { user, isAuthenticated, isInitializing, updateUser } = useUser()
    const e = useEntitlements()
    updateUserRef = updateUser
    if (isInitializing) return <div data-testid="init" />
    return (
        <div>
            <span data-testid="auth">{String(isAuthenticated)}</span>
            <span data-testid="name">{user?.fullName ?? ''}</span>
            <span data-testid="write">{String(e.canWrite)}</span>
            <span data-testid="read">{String(e.canRead)}</span>
            <span data-testid="plan">{e.planCode ?? 'none'}</span>
        </div>
    )
}

const online = (user: User) =>
    vi.mocked(axiosInstance.post).mockImplementation(async (url: string) => {
        if (url === API_PATHS.AUTH.REFRESH) return { success: true, data: { token: 't', user, offlineGrant: null } }
        throw new Error('unused')
    })

const offline = () => vi.mocked(axiosInstance.post).mockRejectedValue(new Error('Network Error'))

const text = (id: string): string | null => screen.getByTestId(id).textContent

beforeEach(() => {
    localStorage.clear()
    updateUserRef = null
    verifyOfflineGrantMock.mockReset()
    verifyOfflineGrantMock.mockResolvedValue(true)
    vi.mocked(axiosInstance.get).mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
    vi.clearAllMocks()
})

describe('entitlement snapshot caching', () => {
    it('caches the snapshot with the user after an online restore', async () => {
        online({ ...baseUser, entitlements: activeSnapshot() })

        renderWithProviders(<Probe />, { withWorkspace: false })
        await waitFor(() => expect(text('auth')).toBe('true'))

        expect(getCachedUser()?.entitlements?.planCode).toBe('pro')
    })

    it('an offline boot with a valid grant restores the last-known entitlements', async () => {
        setCachedUser({ ...baseUser, entitlements: activeSnapshot() })
        offline()

        renderWithProviders(<Probe />, { withWorkspace: false })

        await waitFor(() => expect(text('auth')).toBe('true'))
        expect(text('write')).toBe('true')
        expect(text('plan')).toBe('pro')
    })

    it('an offline boot restores a lapsed snapshot as read-only, still signed in', async () => {
        setCachedUser({
            ...baseUser,
            entitlements: activeSnapshot({ status: 'trial_expired', canWrite: false, canSyncPush: false }),
        })
        offline()

        renderWithProviders(<Probe />, { withWorkspace: false })

        await waitFor(() => expect(text('auth')).toBe('true'))
        expect(text('write')).toBe('false')
        expect(text('read')).toBe('true')
    })

    it('an offline boot whose cached snapshot has aged past writableUntil is read-only, not locked', async () => {
        setCachedUser({
            ...baseUser,
            entitlements: activeSnapshot({ status: 'trialing', writableUntil: new Date(Date.now() - 1000).toISOString() }),
        })
        offline()

        renderWithProviders(<Probe />, { withWorkspace: false })

        await waitFor(() => expect(text('auth')).toBe('true'))
        expect(text('write')).toBe('false')
        expect(text('read')).toBe('true')
    })

    it('an offline boot from a cache that predates entitlements is signed in and read-only', async () => {
        setCachedUser(baseUser)
        offline()

        renderWithProviders(<Probe />, { withWorkspace: false })

        await waitFor(() => expect(text('auth')).toBe('true'))
        expect(text('write')).toBe('false')
        expect(text('read')).toBe('true')
    })

    it('the entitlement snapshot buys no offline access of its own: an invalid grant still signs out', async () => {
        setCachedUser({ ...baseUser, entitlements: activeSnapshot() })
        verifyOfflineGrantMock.mockResolvedValue(false)
        offline()

        renderWithProviders(<Probe />, { withWorkspace: false })

        await waitFor(() => expect(text('auth')).toBe('false'))
        expect(getCachedUser()).toBeNull()
    })
})

describe('updateUser keeps the snapshot', () => {
    it('a user object without entitlements does not wipe the existing snapshot', async () => {
        online({ ...baseUser, entitlements: activeSnapshot() })
        renderWithProviders(<Probe />, { withWorkspace: false })
        await waitFor(() => expect(text('write')).toBe('true'))

        act(() => updateUserRef!({ ...baseUser, fullName: 'Renamed' }))

        await waitFor(() => expect(text('name')).toBe('Renamed'))
        expect(text('write')).toBe('true')
        expect(getCachedUser()?.entitlements?.planCode).toBe('pro')
    })

    it('a user object carrying a new snapshot replaces the old one', async () => {
        online({ ...baseUser, entitlements: activeSnapshot() })
        renderWithProviders(<Probe />, { withWorkspace: false })
        await waitFor(() => expect(text('write')).toBe('true'))

        act(() =>
            updateUserRef!({
                ...baseUser,
                entitlements: activeSnapshot({ status: 'cancelled', canWrite: false, canSyncPush: false }),
            })
        )

        await waitFor(() => expect(text('write')).toBe('false'))
    })
})
