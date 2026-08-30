import { useCallback, useEffect, useState } from 'react'
import { tableInvalidationBus } from '../db/invalidation/tableInvalidationBus'
import {
    discardSyncOp,
    getSyncStatus,
    resetLocalData,
    retrySyncOp,
    syncNow,
    type SyncStatus,
} from '../sync/syncEngine'

const DEFAULT_STATUS: SyncStatus = {
    online: true,
    pendingCount: 0,
    conflictCount: 0,
    failedCount: 0,
    failedOps: [],
    lastSyncedAt: null,
}

interface UseSyncStatusResult extends SyncStatus {
    syncing: boolean
    syncNow: () => Promise<void>
    resetLocalData: () => Promise<void>
    retryOp: (opId: string) => Promise<void>
    discardOp: (opId: string) => Promise<void>
}

/** Drives `SyncStatusBadge` and the "Sync issues" panel: online/offline, pending-op count, last-synced time. */
export const useSyncStatus = (): UseSyncStatusResult => {
    const [status, setStatus] = useState<SyncStatus>(DEFAULT_STATUS)
    const [syncing, setSyncing] = useState(false)

    const refresh = useCallback(() => {
        void getSyncStatus().then(setStatus)
    }, [])

    useEffect(() => {
        refresh()

        const unsubOutbox = tableInvalidationBus.subscribe('_outbox', refresh)
        const unsubConflicts = tableInvalidationBus.subscribe('_conflicts', refresh)
        window.addEventListener('online', refresh)
        window.addEventListener('offline', refresh)

        return () => {
            unsubOutbox()
            unsubConflicts()
            window.removeEventListener('online', refresh)
            window.removeEventListener('offline', refresh)
        }
    }, [refresh])

    const handleSyncNow = useCallback(async () => {
        setSyncing(true)
        try {
            await syncNow()
        } finally {
            setSyncing(false)
            refresh()
        }
    }, [refresh])

    const handleReset = useCallback(async () => {
        await resetLocalData()
        refresh()
    }, [refresh])

    const handleRetryOp = useCallback(
        async (opId: string) => {
            await retrySyncOp(opId)
            refresh()
        },
        [refresh]
    )

    const handleDiscardOp = useCallback(
        async (opId: string) => {
            await discardSyncOp(opId)
            refresh()
        },
        [refresh]
    )

    return {
        ...status,
        syncing,
        syncNow: handleSyncNow,
        resetLocalData: handleReset,
        retryOp: handleRetryOp,
        discardOp: handleDiscardOp,
    }
}
