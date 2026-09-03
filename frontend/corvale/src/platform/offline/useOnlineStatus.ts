import { useEffect, useRef, useState } from 'react'
import { probeReachability } from './reachability'

const DEFAULT_PROBE_INTERVAL_MS = 30000

/** A single slow/dropped probe (dev server restart, a brief network hiccup) shouldn't flip the
 * whole app into "offline" mode - require this many consecutive failures before reporting
 * offline, while any successful probe or a native `online` event clears it immediately. */
const CONSECUTIVE_FAILURES_BEFORE_OFFLINE = 2

/**
 * Online/offline state driven by `navigator.onLine` + its events for instant feedback, plus a
 * periodic real reachability probe so a browser that thinks it's online (network adapter up,
 * no actual route to the backend) doesn't get stuck reporting `online: true`.
 */
export const useOnlineStatus = (probeIntervalMs: number = DEFAULT_PROBE_INTERVAL_MS): boolean => {
    const [online, setOnline] = useState<boolean>(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
    const consecutiveFailures = useRef(0)

    useEffect(() => {
        const handleOnline = () => {
            consecutiveFailures.current = 0
            setOnline(true)
        }
        const handleOffline = () => {
            consecutiveFailures.current = CONSECUTIVE_FAILURES_BEFORE_OFFLINE
            setOnline(false)
        }
        window.addEventListener('online', handleOnline)
        window.addEventListener('offline', handleOffline)

        const interval = setInterval(() => {
            void probeReachability().then((reachable) => {
                if (reachable) {
                    consecutiveFailures.current = 0
                    setOnline(true)
                    return
                }

                consecutiveFailures.current += 1
                if (consecutiveFailures.current >= CONSECUTIVE_FAILURES_BEFORE_OFFLINE) {
                    setOnline(false)
                }
            })
        }, probeIntervalMs)

        return () => {
            window.removeEventListener('online', handleOnline)
            window.removeEventListener('offline', handleOffline)
            clearInterval(interval)
        }
    }, [probeIntervalMs])

    return online
}
