import React, { useState } from 'react'
import { Link } from 'react-router-dom'

import BrandLogo from '@ui/BrandLogo'
import ErrorState from '@ui/ErrorState'
import LoadingState from '@ui/LoadingState'
import { BRAND } from '@lib/brand'
import { useAsyncData } from '@/app/hooks/useAsyncData'
import { useUser } from '@/app/providers/useUser'
import { fetchPublicPlans } from './billingApi'
import { formatUsd, yearlySavingsPercent } from './billingFormat'
import IntervalToggle from './components/IntervalToggle'
import PlanFacts from './components/PlanFacts'
import type { BillingInterval, PublicPlan } from './types'

const PlanCard: React.FC<{ plan: PublicPlan; interval: BillingInterval; signedIn: boolean }> = ({ plan, interval, signedIn }) => {
    const savings = yearlySavingsPercent(plan.prices)

    return (
        <article className="glass-card card flex flex-col rounded-xl">
            <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-xl font-bold text-text-primary">{plan.name}</h2>
                {interval === 'annual' && savings > 0 && (
                    <span className="rounded-full bg-accent-subtle px-2.5 py-0.5 text-xs font-medium text-accent">Save {savings}%</span>
                )}
            </div>

            <p className="mt-4 flex items-baseline gap-1">
                <span className="font-display text-4xl font-bold text-text-primary">{formatUsd(plan.prices[interval])}</span>
                <span className="text-sm text-text-muted">{interval === 'annual' ? '/ year' : '/ month'}</span>
            </p>

            <div className="mt-6 flex-1">
                <PlanFacts plan={plan} />
            </div>

            {signedIn ? (
                <Link to="/settings/billing" className="btn-primary mt-6 text-center">
                    Choose {plan.name}
                </Link>
            ) : (
                <Link to="/signup" className="btn-primary mt-6 text-center">
                    Start free trial
                </Link>
            )}
        </article>
    )
}

/**
 * Public. It sells only what the server says is on sale: with billing off (self-hosted, or before
 * launch) the plan list is empty and this page says so instead of showing prices nobody can pay.
 */
const PricingPage: React.FC = () => {
    const { isAuthenticated } = useUser()
    const [interval, setInterval] = useState<BillingInterval>('monthly')
    const { data, loading, error, refetch } = useAsyncData(fetchPublicPlans, [])

    return (
        <div className="min-h-screen bg-page text-text-primary">
            <header className="sticky top-0 z-50 px-4 pt-4 sm:px-6">
                <div className="glass-nav mx-auto flex max-w-5xl items-center justify-between rounded-full px-4 py-2.5 sm:px-6">
                    <BrandLogo size="sm" showTagline={false} />
                    <Link to="/" className="btn-ghost py-2 px-3">
                        Back to {BRAND.name}
                    </Link>
                </div>
            </header>

            <main className="px-4 py-14 sm:px-6">
                <div className="mx-auto max-w-4xl">
                    <div className="text-center">
                        <p className="section-label">Pricing</p>
                        <h1 className="font-display mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Pick the plan that fits</h1>
                    </div>

                    {loading && <LoadingState message="Loading plans..." />}
                    {!loading && error && <ErrorState message={error} onRetry={() => void refetch()} />}

                    {!loading && !error && data && !data.billingEnabled && (
                        <p className="mt-10 text-center text-text-secondary">Paid plans are not available on this server.</p>
                    )}

                    {!loading && !error && data?.billingEnabled && (
                        <>
                            <p className="mx-auto mt-4 max-w-xl text-center text-text-secondary leading-relaxed">
                                Every account starts with a {data.trialDays}-day free trial, no card required. Prices are in USD.
                            </p>

                            <div className="mt-8 flex justify-center">
                                <IntervalToggle value={interval} onChange={setInterval} />
                            </div>

                            <div className="mt-8 grid gap-4 sm:grid-cols-2">
                                {data.plans.map((plan) => (
                                    <PlanCard key={plan.code} plan={plan} interval={interval} signedIn={isAuthenticated} />
                                ))}
                            </div>

                            <p className="mt-8 text-center text-sm text-text-muted">
                                Your data stays yours: export or back up everything at any time, on every plan, even if you stop paying.
                            </p>
                        </>
                    )}
                </div>
            </main>
        </div>
    )
}

export default PricingPage
