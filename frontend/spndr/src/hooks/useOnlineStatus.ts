import { useEffect, useState } from 'react'
import { probeReachability } from '../offline/reachability'

const DEFAULT_PROBE_INTERVAL_MS = 30000

/**
 * Online/offline state driven by `navigator.onLine` + its events for instant feedback, plus a
 * periodic real reachability probe so a browser that thinks it's online (network adapter up,
 * no actual route to the backend) doesn't get stuck reporting `online: true`.
 */
export const useOnlineStatus = (probeIntervalMs: number = DEFAULT_PROBE_INTERVAL_MS): boolean => {
    const [online, setOnline] = useState<boolean>(() => (typeof navigator === 'undefined' ? true : navigator.onLine))

    useEffect(() => {
        const handleOnline = () => setOnline(true)
        const handleOffline = () => setOnline(false)
        window.addEventListener('online', handleOnline)
        window.addEventListener('offline', handleOffline)

        const interval = setInterval(() => {
            void probeReachability().then(setOnline)
        }, probeIntervalMs)

        return () => {
            window.removeEventListener('online', handleOnline)
            window.removeEventListener('offline', handleOffline)
            clearInterval(interval)
        }
    }, [probeIntervalMs])

    return online
}
