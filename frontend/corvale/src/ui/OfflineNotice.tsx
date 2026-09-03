import React from 'react'
import { FiWifiOff } from 'react-icons/fi'

interface OfflineNoticeProps {
    message?: string
}

/** Inline "you're offline" hint for forms that always require the network (auth flows, receipt
 * upload) - distinct from the app-wide `pwa/OfflineBanner.tsx`, which is a top-of-page banner. */
const OfflineNotice: React.FC<OfflineNoticeProps> = ({ message = 'You are offline. Reconnect to continue.' }) => (
    <p className="flex items-center gap-1.5 text-xs text-warning pb-2.5">
        <FiWifiOff size={12} className="shrink-0" />
        {message}
    </p>
)

export default OfflineNotice
