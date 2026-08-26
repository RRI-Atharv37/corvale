import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// X1/BUG-07: a 401 must clear the in-memory token AND tell UserContext to clear its own state,
// for every reason a session ends - not just the narrow "explicit server revocation" case that
// TOKEN_REVOKED_EVENT already covered. This file drives the real response interceptor directly
// (captured off a mocked `axios.create()`) so the refresh-attempt/no-refresh branches and the
// SESSION_EXPIRED_EVENT/TOKEN_REVOKED_EVENT dispatch can be asserted without a live HTTP layer.

const { interceptors, postMock } = vi.hoisted(() => ({
    interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
    },
    postMock: vi.fn(),
}))

vi.mock('axios', async () => {
    const actual = await vi.importActual<typeof import('axios')>('axios')
    const mockClient = vi.fn() as unknown as { interceptors: typeof interceptors; defaults: Record<string, unknown> }
    mockClient.interceptors = interceptors
    mockClient.defaults = {}
    return {
        ...actual,
        default: {
            ...actual.default,
            create: vi.fn(() => mockClient),
            post: postMock,
        },
    }
})

import { getAccessToken, setAccessToken } from '../tokenStore'
import { SESSION_EXPIRED_EVENT } from '../sessionEvents'
import { TOKEN_REVOKED_EVENT } from '../../offline/tokenRevokedFlow'
import '../axiosInstance'

const getResponseErrorHandler = (): ((error: unknown) => Promise<unknown>) => {
    const call = interceptors.response.use.mock.calls[0]
    return call[1] as (error: unknown) => Promise<unknown>
}

const makeError = (status: number, message: string, url = '/transactions') => ({
    config: { url, headers: {} as Record<string, string> },
    response: { status, data: { message } },
})

describe('axiosInstance response interceptor - session clearing (BUG-07)', () => {
    let dispatchedEventTypes: string[]

    beforeEach(() => {
        setAccessToken('existing-token')
        postMock.mockReset()
        dispatchedEventTypes = []
        vi.spyOn(window, 'dispatchEvent').mockImplementation((event: Event) => {
            dispatchedEventTypes.push(event.type)
            return true
        })
    })

    afterEach(() => {
        // Not vi.restoreAllMocks(): it would also reset interceptors.response.use's recorded
        // call, and axiosInstance's module-level `client.interceptors.response.use(...)` only
        // runs once (on the side-effect import above), not per-test.
        vi.mocked(window.dispatchEvent).mockRestore?.()
        setAccessToken(null)
    })

    it('clears the token and fires SESSION_EXPIRED_EVENT when a refresh-eligible 401 fails to refresh', async () => {
        postMock.mockRejectedValue(new Error('refresh failed'))
        const handler = getResponseErrorHandler()

        await expect(handler(makeError(401, 'jwt expired'))).rejects.toBeTruthy()

        expect(getAccessToken()).toBeNull()
        expect(dispatchedEventTypes).toContain(SESSION_EXPIRED_EVENT)
        expect(dispatchedEventTypes).not.toContain(TOKEN_REVOKED_EVENT)
    })

    it('fires both SESSION_EXPIRED_EVENT and TOKEN_REVOKED_EVENT for an explicit session revocation', async () => {
        postMock.mockRejectedValue(new Error('refresh failed'))
        const handler = getResponseErrorHandler()

        await expect(handler(makeError(401, 'Not authorized, session revoked'))).rejects.toBeTruthy()

        expect(getAccessToken()).toBeNull()
        expect(dispatchedEventTypes).toContain(SESSION_EXPIRED_EVENT)
        expect(dispatchedEventTypes).toContain(TOKEN_REVOKED_EVENT)
    })

    it('clears the token and fires SESSION_EXPIRED_EVENT for a plain non-refreshable 401', async () => {
        const handler = getResponseErrorHandler()

        await expect(handler(makeError(401, 'Not authorized, no token'))).rejects.toBeTruthy()

        expect(getAccessToken()).toBeNull()
        expect(dispatchedEventTypes).toContain(SESSION_EXPIRED_EVENT)
        expect(postMock).not.toHaveBeenCalled()
    })

    it('does not clear the token or fire any session event for a 401 on an auth-mutation route', async () => {
        const handler = getResponseErrorHandler()

        await expect(handler(makeError(401, 'Invalid email or password', '/auth/login'))).rejects.toBeTruthy()

        expect(getAccessToken()).toBe('existing-token')
        expect(dispatchedEventTypes).not.toContain(SESSION_EXPIRED_EVENT)
        expect(dispatchedEventTypes).not.toContain(TOKEN_REVOKED_EVENT)
    })
})
