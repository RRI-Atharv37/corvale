import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { FiAlertTriangle } from 'react-icons/fi'

import type { FailedSyncOp } from '@platform/sync/syncEngine'
import { parseOutboxEntity } from '@platform/sync/entityMap'

interface FailedSyncOpsProps {
    failedOps: FailedSyncOp[]
    onRetry: (opId: string) => Promise<void>
    onDiscard: (opId: string) => Promise<void>
}

const describeOp = (op: FailedSyncOp): string => {
    const { entityType } = parseOutboxEntity(op.entity)
    const verb = op.operation === 'create' ? 'New' : op.operation === 'delete' ? 'Deleted' : 'Edited'
    return `${verb} ${entityType}`
}

/**
 * The list of outbox ops the server rejected (BUG-32). Each row shows the server's reason and
 * lets the user retry it now or discard it for good - the change is otherwise stuck forever with
 * every other indicator reading "Synced".
 */
const FailedSyncOps: React.FC<FailedSyncOpsProps> = ({ failedOps, onRetry, onDiscard }) => {
    const [busyId, setBusyId] = useState<string | null>(null)

    if (failedOps.length === 0) {
        return null
    }

    const handleRetry = async (opId: string) => {
        setBusyId(opId)
        try {
            await onRetry(opId)
            toast.success('Retrying…')
        } catch {
            toast.error('Could not retry that change')
        } finally {
            setBusyId(null)
        }
    }

    const handleDiscard = async (opId: string) => {
        const confirmed = window.confirm(
            'Discard this change? It will not be sent to the server and cannot be recovered.'
        )
        if (!confirmed) return

        setBusyId(opId)
        try {
            await onDiscard(opId)
            toast.success('Change discarded')
        } catch {
            toast.error('Could not discard that change')
        } finally {
            setBusyId(null)
        }
    }

    return (
        <ul className="divide-y divide-border-subtle">
            {failedOps.map((op) => (
                <li key={op.opId} className="px-4 py-3">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                        <FiAlertTriangle size={14} />
                        {describeOp(op)} — rejected by the server
                    </p>
                    <p className="mt-1 text-xs text-fg-muted leading-relaxed">{op.lastError}</p>
                    <div className="mt-2 flex gap-2">
                        <button
                            type="button"
                            onClick={() => void handleRetry(op.opId)}
                            disabled={busyId === op.opId}
                            className="rounded-lg border border-border-subtle px-2.5 py-1 text-xs font-medium text-fg-muted hover:text-accent hover:border-accent/40 disabled:opacity-50"
                        >
                            Retry now
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleDiscard(op.opId)}
                            disabled={busyId === op.opId}
                            className="rounded-lg border border-border-subtle px-2.5 py-1 text-xs font-medium text-fg-muted hover:text-destructive hover:border-destructive/40 disabled:opacity-50"
                        >
                            Discard this change
                        </button>
                    </div>
                </li>
            ))}
        </ul>
    )
}

export default FailedSyncOps
