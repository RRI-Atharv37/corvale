import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isTauriRuntime } from '@lib/isTauri'
import { DEVICE_ID_STORAGE_KEY, getDeviceId, getDeviceIdentity, getDeviceKind } from '../deviceIdentity'

vi.mock('@lib/isTauri', () => ({ isTauriRuntime: vi.fn(() => false) }))

// The server accepts exactly this shape and answers 400 to anything else on a sync call.
const SERVER_DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/

const setDisplayMode = (standalone: boolean): void => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: standalone && query === '(display-mode: standalone)',
        media: query,
    })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
    localStorage.clear()
    vi.mocked(isTauriRuntime).mockReturnValue(false)
    setDisplayMode(false)
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('getDeviceId', () => {
    it('makes an id the server will accept and keeps it in local storage', () => {
        const id = getDeviceId()

        expect(id).toMatch(SERVER_DEVICE_ID)
        expect(localStorage.getItem(DEVICE_ID_STORAGE_KEY)).toBe(id)
    })

    it('is the same on every call, so the server sees one device', () => {
        expect(getDeviceId()).toBe(getDeviceId())
    })

    it('reuses an id already stored, e.g. from an earlier launch', () => {
        localStorage.setItem(DEVICE_ID_STORAGE_KEY, 'stored-id_1')

        expect(getDeviceId()).toBe('stored-id_1')
    })

    it.each(['', 'has space', 'x'.repeat(65), 'a/b', 'é'])('replaces a stored value the server would refuse (%j)', (bad) => {
        localStorage.setItem(DEVICE_ID_STORAGE_KEY, bad)

        const id = getDeviceId()

        expect(id).toMatch(SERVER_DEVICE_ID)
        expect(localStorage.getItem(DEVICE_ID_STORAGE_KEY)).toBe(id)
    })

    it('two installs get different ids', () => {
        const first = getDeviceId()
        localStorage.clear()

        expect(getDeviceId()).not.toBe(first)
    })

    it('holds one id for the session when storage cannot be used, rather than minting a new device per call', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked')
        })
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked')
        })

        const first = getDeviceId()

        expect(first).toMatch(SERVER_DEVICE_ID)
        expect(getDeviceId()).toBe(first)
    })

    it('carries nothing that describes the machine: it is random, not derived from the browser', () => {
        Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Windows NT 10.0) Chrome/139', configurable: true })

        expect(getDeviceId()).not.toMatch(/windows|chrome|mozilla/i)
    })
})

describe('getDeviceKind', () => {
    it('is web in an ordinary browser tab', () => {
        expect(getDeviceKind()).toBe('web')
    })

    it('is desktop inside the Tauri shell, even if the window also reports standalone', () => {
        vi.mocked(isTauriRuntime).mockReturnValue(true)
        setDisplayMode(true)

        expect(getDeviceKind()).toBe('desktop')
    })

    it('is pwa when the app was installed and runs standalone', () => {
        setDisplayMode(true)

        expect(getDeviceKind()).toBe('pwa')
    })

    it('is pwa for an iOS home-screen launch, which reports standalone on navigator instead', () => {
        Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })

        expect(getDeviceKind()).toBe('pwa')

        Object.defineProperty(navigator, 'standalone', { value: undefined, configurable: true })
    })

    it('falls back to web when the browser has no matchMedia', () => {
        ;(window as { matchMedia?: unknown }).matchMedia = undefined

        expect(getDeviceKind()).toBe('web')
    })
})

describe('getDeviceIdentity', () => {
    it('is the id and the kind together, in the field names the sync wire uses', () => {
        expect(getDeviceIdentity()).toEqual({ deviceId: getDeviceId(), deviceKind: 'web' })
    })
})
