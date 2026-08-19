import { AxiosError } from 'axios'
import { BASE_URL } from '../utils/apiPaths'

/**
 * `navigator.onLine` only reflects whether the OS thinks a network interface is up - it's
 * `true` on a LAN with no internet route or behind a captive portal. This probe makes an
 * actual request to the API origin so "online" means "the backend is reachable", not just
 * "a network adapter is active".
 */
export const probeReachability = async (timeoutMs = 4000): Promise<boolean> => {
    if (typeof fetch === 'undefined') return true

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        // `no-cors` avoids needing CORS headers just to learn "something answered"; the
        // opaque response is never read, only its absence (a thrown network error) matters.
        await fetch(BASE_URL, { method: 'GET', mode: 'no-cors', signal: controller.signal })
        return true
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
