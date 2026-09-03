import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../sync/syncEngine', () => ({ resetLocalData: vi.fn(async () => {}) }))
vi.mock('../cachedUser', () => ({ setCachedUser: vi.fn() }))
vi.mock('@lib/offlineGrant', () => ({ clearOfflineGrant: vi.fn() }))
vi.mock('@lib/tokenStore', () => ({ setAccessToken: vi.fn() }))
vi.mock('../pinStorage', async () => {
    const actual = await vi.importActual<typeof import('../pinStorage')>('../pinStorage')
    return { ...actual, clearLocalEncryptionKey: vi.fn(async () => {}) }
})

const { wipeLocalData } = await import('../wipeLocalData')

const PIN_VERIFIER_KEY = 'corvale_pin_verifier'
const PIN_SALT_KEY = 'corvale_pin_salt'
const LEGACY_PIN_VERIFIER_KEY = 'spndr_pin_verifier'

describe('wipeLocalData (BUG-30: report a cleared PIN)', () => {
    beforeEach(() => {
        localStorage.clear()
    })
    afterEach(() => {
        localStorage.clear()
    })

    it('reports pinCleared: false when no PIN material is present', async () => {
        const result = await wipeLocalData()
        expect(result).toEqual({ pinCleared: false })
    })

    it('reports pinCleared: true and removes a current-name PIN verifier', async () => {
        localStorage.setItem(PIN_VERIFIER_KEY, 'verifier')
        localStorage.setItem(PIN_SALT_KEY, 'salt')

        const result = await wipeLocalData()

        expect(result).toEqual({ pinCleared: true })
        expect(localStorage.getItem(PIN_VERIFIER_KEY)).toBeNull()
        expect(localStorage.getItem(PIN_SALT_KEY)).toBeNull()
    })

    it('reports pinCleared: true and removes a pre-rename spndr_pin_* verifier', async () => {
        localStorage.setItem(LEGACY_PIN_VERIFIER_KEY, 'legacy-verifier')

        const result = await wipeLocalData()

        expect(result).toEqual({ pinCleared: true })
        expect(localStorage.getItem(LEGACY_PIN_VERIFIER_KEY)).toBeNull()
    })
})
