/**
 * Fixed desktop-app origins admitted alongside the configured web `CLIENT_URL` (SEC-10/S17).
 * A single string origin can't also serve a Tauri client, since it uses a custom scheme
 * rather than a regular http(s) origin: `tauri://localhost` on macOS/Linux, and
 * `http://tauri.localhost` on Windows (see ROADMAP.md's desktop distribution section).
 */
export const DESKTOP_ORIGINS = ['tauri://localhost', 'http://tauri.localhost'] as const

export const buildCorsOriginAllowlist = (clientUrl: string): string[] => [
    clientUrl,
    ...DESKTOP_ORIGINS,
]
