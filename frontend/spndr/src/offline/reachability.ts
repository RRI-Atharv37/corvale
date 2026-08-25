import { AxiosError } from 'axios'
import { BASE_URL } from '../utils/apiPaths'

// Backend's `Cross-Origin-Resource-Policy: same-origin` (SEC-07 hardening) makes browsers hard-block
// `no-cors` cross-origin fetches outright (`net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`) before the
// request ever reaches the network - so a `no-cors` probe reports "offline" unconditionally,
// regardless of real connectivity. A normal `cors`-mode request works because the backend's CORS
// allowlist (SEC-10) already grants this origin explicit access, same as every other API call.
// `/health` (mounted outside `/api/v1`) is unauthenticated, doesn't touch Mongo, and is exempt from
// the API rate limiter, making it a safe, side-effect-free reachability check.
const HEALTH_URL = `${new URL(BASE_URL).origin}/health`

/**
 * `navigator.onLine` only reflects whether the OS thinks a network interface is up - it's
 * `true` on a LAN with no internet route or behind a captive portal. This probe makes an
 * actual request to the API origin so "online" means "the backend is reachable", not just
 * "a network adapter is active".
 */
export const probeReachability = async (timeoutMs = 6000): Promise<boolean> => {
    if (typeof fetch === 'undefined') return true

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const response = await fetch(HEALTH_URL, { method: 'GET', signal: controller.signal })
        return response.ok
    } catch {
        return false
    } finally {
        clearTimeout(timer)
    }
}

/** True when `error` looks like a network failure (no response reached the caller at all), as opposed to a server-returned error status. */
export const isNetworkError = (error: unknown): boolean => {
    if (error instanceof AxiosError) {
        return !error.response
    }
    return error instanceof Error
}
