import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { FiRefreshCw, FiTrash2 } from 'react-icons/fi'

import { useSyncStatus } from '../../hooks/useSyncStatus'
import { formatRelativeTime } from '../../utils/format'

/** "Reset local data" + manual sync, surfaced in the Settings modal when `VITE_LOCAL_FIRST` is on. */
const SyncSettings: React.FC = () => {
    const { pendingCount, lastSyncedAt, syncing, syncNow, resetLocalData } = useSyncStatus()
    const [resetting, setResetting] = useState(false)

    const handleSyncNow = async () => {
        try {
            await syncNow()
            toast.success('Synced')
        } catch {
            toast.error('Sync failed - will retry automatically')
        }
    }

    const handleReset = async () => {
        const confirmed = window.confirm(
            'Reset local data? This clears everything cached on this device and re-downloads it on the next sync. Any changes not yet synced will be lost.'
        )
        if (!confirmed) return

        setResetting(true)
        try {
            await resetLocalData()
            toast.success('Local data reset')
        } catch {
            toast.error('Failed to reset local data')
        } finally {
            setResetting(false)
        }
    }

    return (
        <div>
            <p className="section-label mb-3">Offline sync</p>
            <div className="rounded-lg bg-bg-secondary px-3 py-2 text-sm text-text-muted">
                {pendingCount > 0
                    ? `${pendingCount} change${pendingCount === 1 ? '' : 's'} waiting to sync`
                    : lastSyncedAt
                      ? `Last synced ${formatRelativeTime(lastSyncedAt)}`
                      : 'Never synced'}
            </div>
            <div className="mt-3 space-y-2">
                <button
                    type="button"
                    onClick={() => void handleSyncNow()}
                    disabled={syncing}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-text-muted hover:text-accent hover:bg-accent-subtle transition-colors disabled:opacity-50"
                >
                    <FiRefreshCw size={18} className={syncing ? 'animate-spin' : ''} />
                    Sync now
                </button>
                <button
                    type="button"
                    onClick={() => void handleReset()}
                    disabled={resetting}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-text-muted hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                >
                    <FiTrash2 size={18} />
                    Reset local data
                </button>
            </div>
        </div>
    )
}

export default SyncSettings
