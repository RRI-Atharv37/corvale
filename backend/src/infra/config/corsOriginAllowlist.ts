import type { Request } from 'express'

/**
 * Fixed desktop-app origins admitted alongside the configured web `CLIENT_URL` (SEC-10/S17).
 * A single string origin can't also serve a Tauri client, since it uses a custom scheme
 * rather than a regular http(s) origin: `tauri://localhost` on macOS/Linux, and
 * `http://tauri.localhost` on Windows (see the desktop distribution architecture notes).
 */
export const DESKTOP_ORIGINS = ['tauri://localhost', 'http://tauri.localhost'] as const

export const buildCorsOriginAllowlist = (clientUrl: string): string[] => [
    clientUrl,
    ...DESKTOP_ORIGINS,
]

/**
 * True when the request comes from the packaged desktop (Tauri) webview, identified by its fixed
 * `Origin` header. The webview — like any browser — forbids page scripts from setting `Origin`,
 * so this can't be forged by a web page or an XSS payload running on the web app's own origin.
 * That is why it is safe to gate the SEC-11 body-delivered refresh token on it (BUG-24): the
 * desktop client is cross-site to the API and never receives the `SameSite=Lax` refresh cookie,
 * so it gets the rotated refresh token in the response body to hold in the OS keychain instead.
 */
export const isDesktopClientRequest = (req: Pick<Request, 'headers'>): boolean => {
    const origin = req.headers.origin
    return typeof origin === 'string' && (DESKTOP_ORIGINS as readonly string[]).includes(origin)
}
