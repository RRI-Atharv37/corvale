import { beforeEach, describe, expect, it, vi } from 'vitest'

// SEC-11 / BUG-24: the desktop (Tauri) client persists its rotated refresh token in the OS
// keychain via the Rust `keychain_*` commands; on the web every call is a no-op because the
// httpOnly cookie is the carrier and JS must never hold the refresh token (SEC-18).

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
    invoke: (...args: unknown[]) => invokeMock(...args),
}))

const isTauriRuntimeMock = vi.fn()
vi.mock('../../desktop/isTauri', () => ({
    isTauriRuntime: () => isTauriRuntimeMock(),
}))

const { getStoredRefreshToken, storeRefreshToken, clearStoredRefreshToken } = await import(
    '../refreshTokenStore'
)

describe('refreshTokenStore', () => {
    beforeEach(() => {
        invokeMock.mockReset()
        isTauriRuntimeMock.mockReset()
    })

    describe('on the web (non-Tauri)', () => {
        beforeEach(() => isTauriRuntimeMock.mockReturnValue(false))

        it('getStoredRefreshToken returns null and never touches the keychain', async () => {
            await expect(getStoredRefreshToken()).resolves.toBeNull()
            expect(invokeMock).not.toHaveBeenCalled()
        })

        it('storeRefreshToken is a no-op', async () => {
            await storeRefreshToken('a-token')
            expect(invokeMock).not.toHaveBeenCalled()
        })

        it('clearStoredRefreshToken is a no-op', async () => {
            await clearStoredRefreshToken()
            expect(invokeMock).not.toHaveBeenCalled()
        })
    })

    describe('on the desktop (Tauri)', () => {
        beforeEach(() => isTauriRuntimeMock.mockReturnValue(true))

        it('reads the token from the keychain', async () => {
            invokeMock.mockResolvedValueOnce('stored-refresh-token')

            await expect(getStoredRefreshToken()).resolves.toBe('stored-refresh-token')
            expect(invokeMock).toHaveBeenCalledWith('keychain_get', { key: 'corvale_refresh_token' })
        })

        it('treats an empty keychain entry as null', async () => {
            invokeMock.mockResolvedValueOnce(null)
            await expect(getStoredRefreshToken()).resolves.toBeNull()

            invokeMock.mockResolvedValueOnce('')
            await expect(getStoredRefreshToken()).resolves.toBeNull()
        })

        it('writes the token to the keychain', async () => {
            invokeMock.mockResolvedValueOnce(undefined)

            await storeRefreshToken('fresh-token')

            expect(invokeMock).toHaveBeenCalledWith('keychain_set', {
                key: 'corvale_refresh_token',
                value: 'fresh-token',
            })
        })

        it('deletes the keychain entry when given a null/undefined token', async () => {
            invokeMock.mockResolvedValue(undefined)

            await storeRefreshToken(null)
            await storeRefreshToken(undefined)

            expect(invokeMock).toHaveBeenCalledTimes(2)
            expect(invokeMock).toHaveBeenLastCalledWith('keychain_delete', { key: 'corvale_refresh_token' })
        })

        it('clearStoredRefreshToken deletes the keychain entry', async () => {
            invokeMock.mockResolvedValueOnce(undefined)

            await clearStoredRefreshToken()

            expect(invokeMock).toHaveBeenCalledWith('keychain_delete', { key: 'corvale_refresh_token' })
        })

        it('never throws when the keychain is unavailable - reads fall back to null', async () => {
            invokeMock.mockRejectedValue(new Error('No secret service available'))

            await expect(getStoredRefreshToken()).resolves.toBeNull()
            await expect(storeRefreshToken('x')).resolves.toBeUndefined()
            await expect(clearStoredRefreshToken()).resolves.toBeUndefined()
        })
    })
})
