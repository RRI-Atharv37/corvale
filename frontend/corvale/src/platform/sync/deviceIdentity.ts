import { isTauriRuntime } from '@lib/isTauri'

export type DeviceKind = 'desktop' | 'web' | 'pwa'

export const DEVICE_ID_STORAGE_KEY = 'corvale_device_id'

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

// Only used when storage is unusable, so a blocked-storage session is still one device rather than one per call.
let sessionDeviceId: string | null = null

const mintDeviceId = (): string =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')

const readStoredId = (): string | null => {
    try {
        const stored = localStorage.getItem(DEVICE_ID_STORAGE_KEY)
        return stored && DEVICE_ID_PATTERN.test(stored) ? stored : null
    } catch {
        return null
    }
}

/** Random and per install: it identifies this copy of the app to the server, not the machine, and is never derived from the browser. */
export const getDeviceId = (): string => {
    const stored = readStoredId()
    if (stored) return stored
    if (sessionDeviceId) return sessionDeviceId

    const id = mintDeviceId()
    try {
        localStorage.setItem(DEVICE_ID_STORAGE_KEY, id)
    } catch {
        sessionDeviceId = id
    }
    return id
}

const isStandaloneDisplay = (): boolean => {
    try {
        if (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) return true
    } catch {
        return false
    }
    return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export const getDeviceKind = (): DeviceKind => {
    if (isTauriRuntime()) return 'desktop'
    return isStandaloneDisplay() ? 'pwa' : 'web'
}

export const getDeviceIdentity = (): { deviceId: string; deviceKind: DeviceKind } => ({
    deviceId: getDeviceId(),
    deviceKind: getDeviceKind(),
})
