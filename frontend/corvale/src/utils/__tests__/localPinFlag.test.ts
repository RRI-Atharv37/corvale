import { afterEach, describe, expect, it, vi } from 'vitest'
import { isLocalPinEnabled } from '../localPinFlag'

/**
 * BUG-31: the local-lock PIN feature is dormant. It only ever activates when BOTH the local-first
 * engine and this dedicated opt-in flag are on - no shipped build sets `VITE_LOCAL_PIN`, so the
 * feature stays off on web and desktop alike until encryption-at-rest is done properly (keyed from
 * the OS keychain at `db_open`, not a user PIN applied to an already-populated plaintext file).
 */
describe('isLocalPinEnabled (BUG-31 dormant-PIN flag)', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('is false when the PIN flag is unset, even with local-first on', () => {
        vi.stubEnv('VITE_LOCAL_FIRST', 'true')
        vi.stubEnv('VITE_LOCAL_PIN', '')

        expect(isLocalPinEnabled()).toBe(false)
    })

    it('is false when the PIN flag is on but local-first is off', () => {
        vi.stubEnv('VITE_LOCAL_FIRST', 'false')
        vi.stubEnv('VITE_LOCAL_PIN', 'true')

        expect(isLocalPinEnabled()).toBe(false)
    })

    it('is true only when both local-first and the PIN flag are on', () => {
        vi.stubEnv('VITE_LOCAL_FIRST', 'true')
        vi.stubEnv('VITE_LOCAL_PIN', 'true')

        expect(isLocalPinEnabled()).toBe(true)
    })
})
