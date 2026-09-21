import React, { useCallback, useState } from 'react'
import toast from 'react-hot-toast'

import ErrorState from '@ui/ErrorState'
import LoadingState from '@ui/LoadingState'
import PageHeader from '@ui/PageHeader'
import { getApiErrorMessage } from '@lib/apiError'
import { openExternalUrl } from '@lib/openExternal'
import { useAsyncData } from '@/app/hooks/useAsyncData'
import { useEntitlements } from '@/app/providers/useEntitlements'
import { useUser } from '@/app/providers/useUser'
import {
    fetchBillingOverview,
    fetchInvoices,
    fetchPublicPlans,
    openBillingPortal,
    requestCancellation,
    requestPlanChange,
    requestResume,
    startCheckout,
} from './billingApi'
import { describeBilling, formatDate, formatUsd, planName, yearlySavingsPercent } from './billingFormat'
import BillingNoticeCard from './components/BillingNoticeCard'
import CancelFlow from './components/CancelFlow'
import IntervalToggle from './components/IntervalToggle'
import InvoiceHistory from './components/InvoiceHistory'
import PlanFacts from './components/PlanFacts'
import { useBillingWatch } from './hooks/useBillingWatch'
import type { BillingInterval, PlanCode, PublicPlan } from './types'

const STATUS_LABEL: Record<string, string> = {
    trialing: 'Trial',
    active: 'Active',
    past_due: 'Payment failed',
    trial_expired: 'Trial ended',
    cancelled: 'Ended',
    none: 'No plan',
}

const PlanOption: React.FC<{
    plan: PublicPlan
    interval: BillingInterval
    selected: boolean
    current: boolean
    onSelect: () => void
}> = ({ plan, interval, selected, current, onSelect }) => {
    const savings = yearlySavingsPercent(plan.prices)

    return (
        <button
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={onSelect}
            className={`rounded-xl border p-4 text-left transition-colors ${
                selected ? 'border-accent bg-accent-subtle' : 'border-border-subtle hover:border-accent/40'
            }`}
        >
            <span className="flex items-center justify-between gap-2">
                <span className="font-display text-lg font-semibold text-text-primary">{plan.name}</span>
                {current && <span className="text-xs font-medium text-accent">Current plan</span>}
            </span>
            <span className="mt-1 block text-sm text-text-secondary">
                {formatUsd(plan.prices[interval])} per {interval === 'annual' ? 'year' : 'month'}
                {interval === 'annual' && savings > 0 && <span className="text-accent"> (save {savings}%)</span>}
            </span>
        </button>
    )
}

const BillingPage: React.FC = () => {
    const { updateUser } = useUser()
    const { entitlements } = useEntitlements()
    const billingEnabled = entitlements.billingEnabled

    const plansQuery = useAsyncData(fetchPublicPlans, [])
    const overviewQuery = useAsyncData(fetchBillingOverview, [])
    const invoicesQuery = useAsyncData(async () => (billingEnabled ? fetchInvoices() : []), [billingEnabled])

    const [planCode, setPlanCode] = useState<PlanCode>(entitlements.planCode ?? 'pro')
    const [interval, setInterval] = useState<BillingInterval>('monthly')
    const [busy, setBusy] = useState(false)
    const [cancelOpen, setCancelOpen] = useState(false)
    const [awaitingPayment, setAwaitingPayment] = useState(false)

    const { refetch: refetchOverview } = overviewQuery
    const { refetch: refetchInvoices } = invoicesQuery
    const { watch } = useBillingWatch({
        onUser: updateUser,
        onChanged: () => {
            setAwaitingPayment(false)
            void refetchOverview()
            void refetchInvoices()
        },
    })

    const run = useCallback(
        async (action: () => Promise<void>, failure: string) => {
            setBusy(true)
            try {
                await action()
                return true
            } catch (error) {
                toast.error(getApiErrorMessage(error, failure))
                return false
            } finally {
                setBusy(false)
            }
        },
        []
    )

    if (!billingEnabled) {
        return (
            <>
                <PageHeader title="Billing" />
                <p className="text-sm text-text-secondary">Billing is not enabled on this server, so there is nothing to manage here.</p>
            </>
        )
    }

    if (plansQuery.loading || overviewQuery.loading) return <LoadingState message="Loading billing..." />

    const loadError = plansQuery.error ?? overviewQuery.error
    if (loadError || !plansQuery.data || !overviewQuery.data) {
        return (
            <ErrorState
                message={loadError ?? 'Billing could not be loaded.'}
                onRetry={() => {
                    void plansQuery.refetch()
                    void overviewQuery.refetch()
                }}
            />
        )
    }

    const plans = plansQuery.data.plans
    const overview = overviewQuery.data
    const now = new Date()
    const notice = describeBilling(entitlements, now)
    const live = overview.hasLiveSubscription
    const ending = entitlements.cancelAtPeriodEnd
    const renewing = entitlements.status === 'active' && !ending && entitlements.currentPeriodEnd

    const checkout = () =>
        run(async () => {
            const url = await startCheckout({ planCode, interval })
            await openExternalUrl(url)
            setAwaitingPayment(true)
            void watch(entitlements)
        }, 'Could not start checkout')

    const changePlan = async () => {
        const ok = await run(() => requestPlanChange({ planCode, interval }), 'Could not change your plan')
        if (!ok) return
        toast.success('Plan change requested. It applies here as soon as our payment provider confirms it.')
        void watch(entitlements)
    }

    const openPortal = () =>
        run(async () => {
            await openExternalUrl(await openBillingPortal())
            void watch(entitlements)
        }, 'Could not open the payment portal')

    const cancel = async () => {
        const ok = await run(requestCancellation, 'Could not cancel your subscription')
        if (!ok) return
        setCancelOpen(false)
        toast.success('Cancellation requested. You keep full access until the end of the period you paid for.')
        void watch(entitlements)
    }

    const resume = async () => {
        const ok = await run(requestResume, 'Could not resume your subscription')
        if (!ok) return
        toast.success('Resume requested. Your subscription will continue as normal.')
        void watch(entitlements)
    }

    return (
        <div className="space-y-6">
            <PageHeader title="Billing" description="Your plan, payments and invoices." />

            {notice && <BillingNoticeCard notice={notice} />}

            <section aria-labelledby="current-plan-heading" className="glass-card card rounded-xl">
                <h2 id="current-plan-heading" className="font-display text-lg font-semibold text-text-primary">
                    Current plan
                </h2>
                <p className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="font-display text-2xl font-bold text-text-primary">
                        {entitlements.planCode ? planName(entitlements.planCode) : 'No plan'}
                    </span>
                    <span className="rounded-full bg-accent-subtle px-2.5 py-0.5 text-xs font-medium text-accent">
                        {STATUS_LABEL[entitlements.status] ?? entitlements.status}
                    </span>
                </p>
                {renewing && <p className="mt-2 text-sm text-text-secondary">Renews on {formatDate(entitlements.currentPeriodEnd)}.</p>}
                {entitlements.status === 'trialing' && !overview.hasBillingCustomer && (
                    <p className="mt-2 text-sm text-text-secondary">No card is on file, and nothing is charged unless you subscribe.</p>
                )}
                {awaitingPayment && (
                    <p role="status" className="mt-3 text-sm text-text-secondary">
                        Finish checkout in the tab that just opened. Your plan will update here as soon as we confirm your payment.
                    </p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                    {overview.hasBillingCustomer && (
                        <button type="button" onClick={() => void openPortal()} disabled={busy} className="btn-ghost">
                            Manage payment details
                        </button>
                    )}
                    {live && ending && (
                        <button type="button" onClick={() => void resume()} disabled={busy} className="btn-primary">
                            Resume subscription
                        </button>
                    )}
                    {live && !ending && !cancelOpen && (
                        <button type="button" onClick={() => setCancelOpen(true)} disabled={busy} className="btn-ghost">
                            Cancel subscription
                        </button>
                    )}
                </div>
            </section>

            {live && !ending && cancelOpen && (
                <CancelFlow
                    periodEnd={entitlements.currentPeriodEnd}
                    retentionDays={overview.retentionDays}
                    canSwitchToPlus={entitlements.planCode === 'pro'}
                    busy={busy}
                    onKeep={() => setCancelOpen(false)}
                    onSwitchToPlus={() => {
                        setPlanCode('plus')
                        setCancelOpen(false)
                    }}
                    onConfirm={() => void cancel()}
                />
            )}

            <section aria-labelledby="plan-picker-heading" className="glass-card card rounded-xl">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 id="plan-picker-heading" className="font-display text-lg font-semibold text-text-primary">
                        {live ? 'Change your plan' : 'Choose your plan'}
                    </h2>
                    <IntervalToggle value={interval} onChange={setInterval} />
                </div>

                <div role="radiogroup" aria-label="Plan" className="mt-4 grid gap-3 sm:grid-cols-2">
                    {plans.map((plan) => (
                        <PlanOption
                            key={plan.code}
                            plan={plan}
                            interval={interval}
                            selected={plan.code === planCode}
                            current={plan.code === entitlements.planCode && live}
                            onSelect={() => setPlanCode(plan.code)}
                        />
                    ))}
                </div>

                {plans.find((plan) => plan.code === planCode) && (
                    <div className="mt-4">
                        <PlanFacts plan={plans.find((plan) => plan.code === planCode) as PublicPlan} />
                    </div>
                )}

                <div className="mt-5">
                    {live ? (
                        <>
                            <button type="button" onClick={() => void changePlan()} disabled={busy} className="btn-primary">
                                Change plan
                            </button>
                            <p className="mt-2 text-xs text-text-muted">Your new plan applies once our payment provider confirms the change.</p>
                        </>
                    ) : (
                        <button type="button" onClick={() => void checkout()} disabled={busy} className="btn-primary">
                            Subscribe
                        </button>
                    )}
                </div>
            </section>

            <InvoiceHistory invoices={invoicesQuery.data} loading={invoicesQuery.loading} error={invoicesQuery.error} />

            <p className="text-xs text-text-muted">You can export your data at any time, on every plan and in every billing state.</p>
        </div>
    )
}

export default BillingPage
