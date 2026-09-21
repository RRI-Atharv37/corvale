import React from 'react'

import { formatDate } from '../billingFormat'

interface CancelFlowProps {
    periodEnd: string | null
    /** Set only while the server is enforcing a retention window; otherwise nothing about erasure is said. */
    retentionDays: number | null
    canSwitchToPlus: boolean
    busy: boolean
    onKeep: () => void
    onSwitchToPlus: () => void
    onConfirm: () => void
}

const CancelFlow: React.FC<CancelFlowProps> = ({
    periodEnd,
    retentionDays,
    canSwitchToPlus,
    busy,
    onKeep,
    onSwitchToPlus,
    onConfirm,
}) => (
    <section
        aria-labelledby="cancel-flow-heading"
        className="space-y-4 rounded-xl border border-border-subtle bg-bg-secondary/60 p-4"
    >
        <h2 id="cancel-flow-heading" className="font-display text-lg font-semibold text-text-primary">
            Cancel your subscription
        </h2>

        <ul className="list-disc space-y-2 pl-5 text-sm text-text-secondary">
            <li>
                {periodEnd
                    ? `You keep full access until ${formatDate(periodEnd)}.`
                    : 'You keep full access until the end of the period you paid for.'}
            </li>
            <li>
                After that your data becomes read-only. Nothing is deleted, and you can export your data whenever you like.
            </li>
            <li>You can subscribe again at any time and pick up exactly where you left off.</li>
            {retentionDays !== null && (
                <li>
                    If your account stays without a subscription for {retentionDays} days, it will be erased. We email you
                    well before that happens.
                </li>
            )}
        </ul>

        <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onKeep} disabled={busy} className="btn-primary">
                Keep my subscription
            </button>
            {canSwitchToPlus && (
                <button type="button" onClick={onSwitchToPlus} disabled={busy} className="btn-ghost">
                    Switch to Plus instead
                </button>
            )}
            <button
                type="button"
                onClick={onConfirm}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
                {busy ? 'Cancelling…' : 'Confirm cancellation'}
            </button>
        </div>
    </section>
)

export default CancelFlow
