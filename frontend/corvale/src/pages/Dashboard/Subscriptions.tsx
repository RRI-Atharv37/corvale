import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { IoBan, IoPlay } from 'react-icons/io5'
import PageHeader from '../../components/ui/PageHeader'
import AsyncContent from '../../components/ui/AsyncContent'
import StatCard from '../../components/ui/StatCard'
import Disclaimer from '../../components/ui/Disclaimer'
import { DISCLAIMERS } from '../../utils/disclaimers'
import { useWorkspace } from '../../hooks/useWorkspace'
import WorkspaceReadOnlyBanner from '../../components/workspaces/WorkspaceReadOnlyBanner'
import { useSubscriptionsData } from './hooks/useSubscriptionsData'
import { getApiErrorMessage } from '../../utils/apiError'
import { formatCurrency, formatDisplayDate } from '../../utils/format'
import { INTERVAL_LABELS } from '../../utils/recurringUtils'

const Subscriptions: React.FC = () => {
    const { activeWorkspace, isPersonal, canEdit } = useWorkspace()
    const [togglingId, setTogglingId] = useState<string | null>(null)

    const { data, loading, error, refetch, toggleCancelled: toggleCancelledData } = useSubscriptionsData()

    const toggleCancelled = async (ruleId: string, isCancelled: boolean) => {
        setTogglingId(ruleId)
        try {
            await toggleCancelledData(ruleId, isCancelled)
            toast.success(isCancelled ? 'Subscription reactivated' : 'Subscription cancelled')
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to update subscription'))
        } finally {
            setTogglingId(null)
        }
    }

    return (
        <div>
            <PageHeader
                title="Subscriptions"
                description={
                    isPersonal
                        ? 'Recurring expenses billed monthly or more often'
                        : `Subscriptions in ${activeWorkspace?.name ?? 'workspace'}`
                }
                note={<Disclaimer>{DISCLAIMERS.subscriptions}</Disclaimer>}
            />

            <WorkspaceReadOnlyBanner />

            <AsyncContent
                loading={loading}
                error={error}
                data={data}
                isEmpty={(d) => d.subscriptions.length === 0}
                loadingMessage="Loading subscriptions..."
                emptyTitle="No subscriptions found"
                emptyDescription="Recurring expenses billed daily, weekly, biweekly, or monthly show up here."
                onRetry={refetch}
            >
                {(d) => (
                    <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-3">
                            <StatCard
                                label="Monthly total"
                                value={formatCurrency(d.totalMonthlyCost)}
                                subtitle={`${d.subscriptions.filter((s) => !s.isCancelled).length} active`}
                                accent="expense"
                            />
                            <StatCard
                                label="Annual total"
                                value={formatCurrency(d.totalAnnualCost)}
                                accent="neutral"
                            />
                        </div>

                        <div className="space-y-3">
                            {d.subscriptions.map((sub) => (
                                <div
                                    key={sub.ruleId}
                                    className={`card flex items-center justify-between gap-4 ${
                                        sub.isCancelled ? 'opacity-60' : ''
                                    }`}
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="text-sm font-medium text-fg truncate">{sub.title}</p>
                                            {sub.isCancelled && (
                                                <span className="rounded-full bg-surface-hover border border-border px-2 py-0.5 text-[11px] text-fg-muted">
                                                    Cancelled
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-fg-muted mt-0.5">
                                            {INTERVAL_LABELS[sub.interval]} · {formatCurrency(sub.amount, sub.currency)}{' '}
                                            · Next charge {formatDisplayDate(sub.nextChargeDate)}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-4 shrink-0">
                                        <div className="text-right">
                                            <p className="text-sm font-semibold text-accent">
                                                {formatCurrency(sub.monthlyCost, sub.currency)}/mo
                                            </p>
                                            <p className="text-[11px] text-fg-muted">
                                                {formatCurrency(sub.annualCost, sub.currency)}/yr
                                            </p>
                                        </div>
                                        {canEdit && (
                                            <button
                                                type="button"
                                                onClick={() => void toggleCancelled(sub.ruleId, sub.isCancelled)}
                                                disabled={togglingId === sub.ruleId}
                                                className="p-1.5 text-fg-muted hover:text-accent transition-colors disabled:opacity-50"
                                                aria-label={sub.isCancelled ? 'Reactivate subscription' : 'Cancel subscription'}
                                                title={sub.isCancelled ? 'Reactivate' : 'Cancel'}
                                            >
                                                {sub.isCancelled ? <IoPlay size={16} /> : <IoBan size={16} />}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </AsyncContent>
        </div>
    )
}

export default Subscriptions
