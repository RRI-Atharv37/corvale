import React from 'react'
import { FiWifiOff } from 'react-icons/fi'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

/** App-wide "you're offline" banner (Sprint 13.8) - mounted once in App.tsx so it covers every
 * route, including pre-auth pages where offline gating matters just as much (see auth pages'
 * `OfflineNotice` and the `axiosInstance` workspace-write gate). */
const OfflineBanner: React.FC = () => {
    const online = useOnlineStatus()

    if (online) return null

    return (
        <div
            role="status"
            className="fixed top-0 inset-x-0 z-[70] flex items-center justify-center gap-2 bg-warning px-4 py-2 text-xs font-semibold text-page"
        >
            <FiWifiOff size={14} />
            You&apos;re offline. Some features are unavailable until you reconnect.
        </div>
    )
}

export default OfflineBanner
