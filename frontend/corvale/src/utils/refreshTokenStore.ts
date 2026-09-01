import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from '../desktop/isTauri'

/**
 * Persistence for the desktop client's refresh token (SEC-11 / BUG-24).
 *
 * The packaged Tauri app runs at `tauri://localhost` / `http://tauri.localhost`, which is
 * cross-site to `api.corvale.app`, so the `SameSite=Lax` refresh cookie is never sent back and
 * the cookie-only refresh path logs the user out at the access-token TTL. Instead the desktop
 * client receives the rotated refresh token in the auth response body and holds it here, in the
 * OS keychain (Windows Credential Manager / macOS Keychain / Linux Secret Service) via the Rust
 * `keychain_*` commands in `src-tauri/src/keychain.rs`. Those commands manage exactly one entry
 * and take no key argument (SEC-42), so this module names no key either.
 *
 * On the web (non-Tauri) every function is a no-op / returns null: there the httpOnly cookie is
 * the carrier and JS must never hold the refresh token (SEC-18).
 *
 * Every call is defensive. A locked or unavailable keychain (e.g. a minimal Linux desktop with
 * no Secret Service provider) must not break sign-in - it just means the session won't outlive
 * the access-token TTL on that machine, the same as before this fix.
 */

export const getStoredRefreshToken = async (): Promise<string | null> => {
    if (!isTauriRuntime()) return null
    try {
        const value = await invoke<string | null>('keychain_get')
        return value && value.length > 0 ? value : null
    } catch (error) {
        console.error('[refreshTokenStore] keychain read failed:', error)
        return null
    }
}

export const storeRefreshToken = async (token: string | null | undefined): Promise<void> => {
    if (!isTauriRuntime()) return
    try {
        if (token) {
            await invoke('keychain_set', { value: token })
        } else {
            await invoke('keychain_delete')
        }
    } catch (error) {
        console.error('[refreshTokenStore] keychain write failed:', error)
    }
}

export const clearStoredRefreshToken = async (): Promise<void> => {
    if (!isTauriRuntime()) return
    try {
        await invoke('keychain_delete')
    } catch (error) {
        console.error('[refreshTokenStore] keychain clear failed:', error)
    }
}
