import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { FiRefreshCw, FiTrash2 } from 'react-icons/fi'

import { useSyncStatus } from '../../hooks/useSyncStatus'
import { formatRelativeTime } from '../../utils/format'
import FailedSyncOps from '../sync/FailedSyncOps'

/** "Reset local data" + manual sync, surfaced in the Settings modal when `VITE_LOCAL_FIRST` is on. */
const SyncSettings: React.FC = () => {
    const { pendingCount, failedCount, failedOps, lastSyncedAt, syncing, syncNow, resetLocalData, retryOp, discardOp } =
        useSyncStatus()
    const [resetting, setResetting] = useState(false)
    const waitingCount = Math.max(0, pendingCount - failedCount)

    const handleSyncNow = async () => {
        try {
            await syncNow()
            toast.success('Synced')
        } catch {
            toast.error('Sync failed - will retry automatically')
        }
    }

    const handleReset = async () => {
        const unsynced = pendingCount > 0 ? ` ${pendingCount} change${pendingCount === 1 ? '' : 's'} not yet synced will be lost.` : ''
        const confirmed = window.confirm(
            `Reset local data? This clears everything cached on this device and re-downloads it on the next sync.${unsynced}`
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
                {waitingCount > 0
                    ? `${waitingCount} change${waitingCount === 1 ? '' : 's'} waiting to sync`
                    : failedCount === 0 && lastSyncedAt
                      ? `Last synced ${formatRelativeTime(lastSyncedAt)}`
                      : failedCount === 0
                        ? 'Never synced'
                        : 'All other changes synced'}
                {failedCount > 0 && (
                    <span className="mt-1 block font-medium text-destructive">
                        {failedCount} change{failedCount === 1 ? '' : 's'} rejected by the server
                    </span>
                )}
            </div>
            {failedCount > 0 && (
                <div className="mt-2 overflow-hidden rounded-lg border border-border-subtle">
                    <FailedSyncOps failedOps={failedOps} onRetry={retryOp} onDiscard={discardOp} />
                </div>
            )}
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
