import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// V5 - timezone auto-detection. Acceptance spec for the once-per-session resync:
// detect -> PATCH only on mismatch -> never more than once per session -> silent on failure ->
// skipped when offline / DB locked.

vi.mock('@lib/axiosInstance', () => ({
    default: { patch: vi.fn() },
}))

vi.mock('@lib/localFirstFlag', () => ({
    isLocalFirstEnabled: vi.fn().mockReturnValue(false),
}))

vi.mock('../offline/pinStorage', () => ({
    hasPinConfigured: vi.fn().mockReturnValue(false),
    isLocalDbUnlocked: vi.fn().mockResolvedValue(true),
}))

import axiosInstance from '@lib/axiosInstance'
import { isLocalFirstEnabled } from '@lib/localFirstFlag'
import { hasPinConfigured, isLocalDbUnlocked } from '../offline/pinStorage'
import {
    detectTimezone,
    syncTimezoneOncePerSession,
    __resetTimezoneSyncForTests,
} from '../timezoneSync'
import type { User } from '@lib/types/api'

const patchMock = vi.mocked(axiosInstance.patch)

const userIn = (timezone: string): User => ({
    _id: 'u1',
    fullName: 'Jamie Rivera',
    email: 'jamie@example.com',
    timezone,
    preferredCurrency: 'USD',
})

const setDeviceZone = (timeZone: string): void => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
        timeZone,
    } as Intl.ResolvedDateTimeFormatOptions)
}

beforeEach(() => {
    __resetTimezoneSyncForTests()
    setDeviceZone('America/New_York')
    patchMock.mockResolvedValue({ success: true, data: userIn('America/New_York') })
    vi.mocked(isLocalFirstEnabled).mockReturnValue(false)
    vi.mocked(hasPinConfigured).mockReturnValue(false)
    vi.mocked(isLocalDbUnlocked).mockResolvedValue(true)
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
})

describe('detectTimezone', () => {
    it('returns the device IANA zone when it is valid', () => {
        setDeviceZone('Asia/Kolkata')
        expect(detectTimezone()).toBe('Asia/Kolkata')
    })

    it('returns null for an unusable zone', () => {
        setDeviceZone('Not/AZone')
        expect(detectTimezone()).toBeNull()
    })
})

describe('syncTimezoneOncePerSession', () => {
    it('PATCHes /auth/user when the device zone differs from the stored one', async () => {
        const applyUser = vi.fn()
        await syncTimezoneOncePerSession(userIn('UTC'), applyUser)

        expect(patchMock).toHaveBeenCalledWith('/auth/user', { timezone: 'America/New_York' })
        expect(applyUser).toHaveBeenCalledWith(userIn('America/New_York'))
    })

    it('does not PATCH when the stored zone already matches the device', async () => {
        await syncTimezoneOncePerSession(userIn('America/New_York'), vi.fn())
        expect(patchMock).not.toHaveBeenCalled()
    })

    it('runs at most once per session even across many calls', async () => {
        await syncTimezoneOncePerSession(userIn('UTC'), vi.fn())
        await syncTimezoneOncePerSession(userIn('UTC'), vi.fn())
        await syncTimezoneOncePerSession(userIn('UTC'), vi.fn())
        expect(patchMock).toHaveBeenCalledTimes(1)
    })

    it('collapses concurrent (StrictMode double-effect) calls into one request', async () => {
        const user = userIn('UTC')
        await Promise.all([
            syncTimezoneOncePerSession(user, vi.fn()),
            syncTimezoneOncePerSession(user, vi.fn()),
        ])
        expect(patchMock).toHaveBeenCalledTimes(1)
    })

    it('no-ops without an authenticated user, and stays retryable once one arrives', async () => {
        await syncTimezoneOncePerSession(null, vi.fn())
        expect(patchMock).not.toHaveBeenCalled()

        await syncTimezoneOncePerSession(userIn('UTC'), vi.fn())
        expect(patchMock).toHaveBeenCalledTimes(1)
    })

    it('skips while offline', async () => {
        Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true })
        await syncTimezoneOncePerSession(userIn('UTC'), vi.fn())
        expect(patchMock).not.toHaveBeenCalled()
        Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
    })

    it('skips when a configured PIN leaves the local DB locked', async () => {
        vi.mocked(isLocalFirstEnabled).mockReturnValue(true)
        vi.mocked(hasPinConfigured).mockReturnValue(true)
        vi.mocked(isLocalDbUnlocked).mockResolvedValue(false)

        await syncTimezoneOncePerSession(userIn('UTC'), vi.fn())
        expect(patchMock).not.toHaveBeenCalled()

        // Unlocking later lets the same session still sync.
        vi.mocked(isLocalDbUnlocked).mockResolvedValue(true)
        await syncTimezoneOncePerSession(userIn('UTC'), vi.fn())
        expect(patchMock).toHaveBeenCalledTimes(1)
    })

    it('never throws or re-attempts loudly when the PATCH fails', async () => {
        patchMock.mockRejectedValueOnce(new Error('network'))
        const applyUser = vi.fn()

        await expect(syncTimezoneOncePerSession(userIn('UTC'), applyUser)).resolves.toBeUndefined()
        expect(applyUser).not.toHaveBeenCalled()

        // Not latched as done - a later mount can retry.
        await syncTimezoneOncePerSession(userIn('UTC'), applyUser)
        expect(patchMock).toHaveBeenCalledTimes(2)
    })

    it('marks the session done via sessionStorage so a reload does not re-sync', async () => {
        await syncTimezoneOncePerSession(userIn('UTC'), vi.fn())
        expect(patchMock).toHaveBeenCalledTimes(1)

        // Simulate a fresh page load: module guard cleared, sessionStorage survives.
        __resetTimezoneSyncForTests()
        await syncTimezoneOncePerSession(userIn('UTC'), vi.fn())
        expect(patchMock).toHaveBeenCalledTimes(1)
    })
})
