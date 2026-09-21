import React from 'react'
import { Link } from 'react-router-dom'
import { FiCreditCard } from 'react-icons/fi'

import { useEntitlements } from '@/app/providers/useEntitlements'
import { describeBilling, isUnreadableSnapshot, planName, whole } from '@features/billing/billingFormat'

interface BillingSettingsProps {
    /** Lets the host close the settings dialog once the link is followed. */
    onNavigate?: () => void
}

const summarise = (entitlements: ReturnType<typeof useEntitlements>['entitlements']): string => {
    const notice = describeBilling(entitlements, new Date())
    const plan = entitlements.planCode ? `${planName(entitlements.planCode)} plan` : 'No plan'

    switch (notice?.kind) {
        case 'trialing':
            return `${plan} trial, ${whole(notice.daysLeft ?? 0, 'day')} left`
        case 'trial-expired':
        case 'cancelled':
        case 'no-subscription':
        case 'access-paused':
            return `${plan}, read-only`
        case 'past-due':
            return `${plan}, payment failed`
        case 'cancelling':
            return `${plan}, ending soon`
        default:
            return plan
    }
}

/** Renders nothing while billing is off, so a self-hosted install never sees a billing section. */
const BillingSettings: React.FC<BillingSettingsProps> = ({ onNavigate }) => {
    const { entitlements } = useEntitlements()

    if (!entitlements.billingEnabled || isUnreadableSnapshot(entitlements)) return null

    return (
        <div>
            <p className="section-label mb-3">Billing</p>
            <Link
                to="/settings/billing"
                onClick={onNavigate}
                className="flex w-full items-center gap-3 rounded-lg border border-border-subtle px-3 py-2.5 text-sm font-medium text-text-primary hover:border-accent/40 transition-colors"
            >
                <FiCreditCard size={18} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                    <span className="block">Billing and plan</span>
                    <span className="block truncate text-xs font-normal text-text-muted">{summarise(entitlements)}</span>
                </span>
            </Link>
        </div>
    )
}

export default BillingSettings
