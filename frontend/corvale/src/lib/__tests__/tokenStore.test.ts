import { describe, it, expect, afterEach } from 'vitest'
import { getAccessToken, setAccessToken } from '../tokenStore'

/** S16, SEC-18: the access token lives in memory only now, never localStorage. */
describe('tokenStore', () => {
    afterEach(() => {
        setAccessToken(null)
    })

    it('has no token by default', () => {
        expect(getAccessToken()).toBeNull()
    })

    it('returns what was set', () => {
        setAccessToken('abc123')
        expect(getAccessToken()).toBe('abc123')
    })

    it('clears back to null', () => {
        setAccessToken('abc123')
        setAccessToken(null)
        expect(getAccessToken()).toBeNull()
    })

    it('never touches localStorage', () => {
        setAccessToken('abc123')
        expect(localStorage.getItem('token')).toBeNull()
    })
})
