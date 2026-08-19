import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FiAlertTriangle, FiCloud, FiCloudOff, FiRefreshCw } from 'react-icons/fi'
import toast from 'react-hot-toast'

import { useSyncStatus } from '../../hooks/useSyncStatus'
import { formatRelativeTime } from '../../utils/format'
import { getLocalDb } from '../../db/localDbInstance'
import { tableInvalidationBus } from '../../db/invalidation/tableInvalidationBus'
import { listUnresolvedConflicts, resolveConflict, type Conflict } from '../../sync/conflicts'

/** Online/offline + pending-op badge with a "Sync issues" conflict inbox (Sprint 13.6). */
const SyncStatusBadge: React.FC = () => {
    const { online, pendingCount, conflictCount, lastSyncedAt, syncing, syncNow } = useSyncStatus()
    const [open, setOpen] = useState(false)
    const [conflicts, setConflicts] = useState<Conflict[]>([])
    const [resolvingId, setResolvingId] = useState<string | null>(null)
    const panelRef = useRef<HTMLDivElement>(null)

    const loadConflicts = useCallback(async () => {
        const db = await getLocalDb()
        setConflicts(await listUnresolvedConflicts(db))
    }, [])

    useEffect(() => {
        void loadConflicts()
        return tableInvalidationBus.subscribe('_conflicts', () => void loadConflicts())
    }, [loadConflicts])

    useEffect(() => {
        if (!open) return
        const handleClickOutside = (event: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [open])

    const handleSyncNow = async () => {
        try {
            await syncNow()
            toast.success('Synced')
        } catch {
            toast.error('Sync failed - will retry automatically')
        }
    }

    const handleResolve = async (conflictId: string, resolution: 'keep-mine' | 'keep-server') => {
        setResolvingId(conflictId)
        try {
            const db = await getLocalDb()
            await resolveConflict(db, conflictId, resolution)
            toast.success(resolution === 'keep-mine' ? 'Keeping your version' : 'Keeping server version')
        } catch {
            toast.error('Failed to resolve conflict')
        } finally {
            setResolvingId(null)
        }
    }

    return (
        <div className="relative" ref={panelRef}>
            <button
                type="button"
                onClick={() => setOpen((prev) => !prev)}
                className="relative flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-fg-muted hover:text-accent hover:border-accent/40 transition-colors"
                aria-label="Sync status"
                aria-expanded={open}
            >
                {online ? <FiCloud size={16} /> : <FiCloudOff size={16} />}
                <span className="hidden sm:inline">{online ? 'Online' : 'Offline'}</span>
                {pendingCount > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-on-accent">
                        {pendingCount > 9 ? '9+' : pendingCount}
                    </span>
                )}
                {conflictCount > 0 && (
                    <FiAlertTriangle size={14} className="text-warning" aria-label="Sync issues" />
                )}
            </button>

            {open && (
                <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
                    <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
                        <div>
                            <p className="text-sm font-semibold text-fg">Sync status</p>
                            <p className="text-xs text-fg-muted mt-0.5">
                                {lastSyncedAt ? `Last synced ${formatRelativeTime(lastSyncedAt)}` : 'Never synced'}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => void handleSyncNow()}
                            disabled={syncing || !online}
                            className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-fg-muted hover:text-accent hover:border-accent/40 disabled:opacity-50 transition-colors"
                        >
                            <FiRefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
                            Sync now
                        </button>
                    </div>

                    <div className="px-4 py-3 text-xs text-fg-muted border-b border-border-subtle">
                        {pendingCount > 0
                            ? `${pendingCount} change${pendingCount === 1 ? '' : 's'} waiting to sync`
                            : 'All changes synced'}
                    </div>

                    <div className="max-h-72 overflow-y-auto">
                        {conflicts.length === 0 ? (
                            <p className="px-4 py-6 text-center text-sm text-fg-muted">No sync issues</p>
                        ) : (
                            <ul className="divide-y divide-slate-800">
                                {conflicts.map((conflict) => (
                                    <li key={conflict.id} className="px-4 py-3">
                                        <p className="text-sm font-medium text-fg">
                                            {conflict.entity} conflict
                                        </p>
                                        <p className="mt-1 text-xs text-fg-muted leading-relaxed">
                                            This record changed on another device before your edit synced.
                                            Choose which version to keep.
                                        </p>
                                        <div className="mt-2 flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => void handleResolve(conflict.id, 'keep-mine')}
                                                disabled={resolvingId === conflict.id}
                                                className="rounded-lg border border-border-subtle px-2.5 py-1 text-xs font-medium text-fg-muted hover:text-accent hover:border-accent/40 disabled:opacity-50"
                                            >
                                                Keep mine
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void handleResolve(conflict.id, 'keep-server')}
                                                disabled={resolvingId === conflict.id}
                                                className="rounded-lg border border-border-subtle px-2.5 py-1 text-xs font-medium text-fg-muted hover:text-accent hover:border-accent/40 disabled:opacity-50"
                                            >
                                                Keep server
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

export default SyncStatusBadge
