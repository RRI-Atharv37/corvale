import { READ_ONLY_ENTITLEMENTS } from '@lib/entitlements'
import type { EntitlementSnapshot } from '@lib/types/api'
import type { BillingNotice, PublicPlan } from './types'

const DAY_MS = 24 * 60 * 60 * 1000
const URGENT_TRIAL_DAYS = 3

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' })

/** Billing is always priced in USD, whatever currency the user tracks their own money in. */
export const formatUsd = (minorUnits: number): string => (minorUnits % 100 === 0 ? usdWhole : usd).format(minorUnits / 100)

export const formatBytes = (bytes: number | null): string => {
    if (bytes === null) return 'Unlimited'
    if (bytes <= 0) return 'None'
    const gb = bytes / 1024 ** 3
    if (gb >= 1) return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`
    return `${Math.round(bytes / 1024 ** 2)} MB`
}

export const formatDate = (iso: string | null): string => {
    const time = iso ? Date.parse(iso) : NaN
    return Number.isNaN(time) ? 'an unknown date' : dateFormat.format(new Date(time))
}

/** A started day counts as a day; a missing or unreadable date is "no time left", never a crash. */
export const wholeDaysLeft = (iso: string | null, now: Date): number => {
    const time = iso ? Date.parse(iso) : NaN
    if (Number.isNaN(time)) return 0
    return Math.max(0, Math.ceil((time - now.getTime()) / DAY_MS))
}

export const whole = (count: number, unit: string): string => `${count} ${unit}${count === 1 ? '' : 's'}`

export const yearlySavingsPercent = (prices: PublicPlan['prices']): number => {
    const twelveMonths = prices.monthly * 12
    if (twelveMonths <= 0 || prices.annual >= twelveMonths) return 0
    return Math.round(((twelveMonths - prices.annual) / twelveMonths) * 100)
}

export const planName = (code: EntitlementSnapshot['planCode']): string =>
    code === 'pro' ? 'Pro' : code === 'plus' ? 'Plus' : 'your'

export const isUnreadableSnapshot = (entitlements: EntitlementSnapshot): boolean =>
    Date.parse(entitlements.resolvedAt) === Date.parse(READ_ONLY_ENTITLEMENTS.resolvedAt)

/**
 * What the user should be told about their billing state, or null when there is nothing to say.
 * Every read-only notice states that the data is kept and can be exported: a billing state changes
 * what a user may do, never what happens to their records. An account that can still write (a
 * grandfathered one) is never nagged, whatever its stored status says.
 */
export const describeBilling = (entitlements: EntitlementSnapshot, now: Date): BillingNotice | null => {
    if (!entitlements.billingEnabled || isUnreadableSnapshot(entitlements)) return null

    const { status, canWrite } = entitlements

    if (status === 'trialing' && canWrite) {
        const daysLeft = wholeDaysLeft(entitlements.trialEndsAt, now)
        return {
            kind: 'trialing',
            tone: daysLeft <= URGENT_TRIAL_DAYS ? 'warning' : 'info',
            title: `Trial: ${whole(daysLeft, 'day')} left`,
            message: `Your trial includes the ${planName(entitlements.planCode)} plan. Pick a plan any time to keep editing after it ends; your data stays either way.`,
            cta: 'Choose a plan',
            daysLeft,
        }
    }

    if (status === 'past_due') {
        return canWrite
            ? {
                  kind: 'past-due',
                  tone: 'warning',
                  title: 'Payment failed',
                  message: `Your last payment failed. Update your payment method by ${formatDate(entitlements.graceEndsAt)} to keep editing.`,
                  cta: 'Update payment',
              }
            : {
                  kind: 'access-paused',
                  tone: 'danger',
                  title: 'Editing is paused',
                  message: 'Editing is paused because a payment failed. Update your payment method to restore it. Your data is untouched and can be exported at any time.',
                  cta: 'Update payment',
              }
    }

    if (status === 'active' && entitlements.cancelAtPeriodEnd && canWrite) {
        return {
            kind: 'cancelling',
            tone: 'info',
            title: 'Subscription ending',
            message: `Your subscription ends on ${formatDate(entitlements.currentPeriodEnd)}. You keep full access until then.`,
            cta: 'Resume subscription',
        }
    }

    if (canWrite) return null

    if (status === 'trial_expired') {
        return {
            kind: 'trial-expired',
            tone: 'danger',
            title: 'Your trial has ended',
            message: 'Your trial has ended, so your data is read-only. Nothing was deleted, and you can export it at any time.',
            cta: 'Choose a plan',
        }
    }

    if (status === 'cancelled') {
        return {
            kind: 'cancelled',
            tone: 'danger',
            title: 'Subscription ended',
            message: 'Your subscription has ended, so your data is read-only. Nothing was deleted, and you can export it at any time.',
            cta: 'Resubscribe',
        }
    }

    return {
        kind: 'no-subscription',
        tone: 'warning',
        title: 'No plan yet',
        message: 'You do not have a plan yet, so your data is read-only. Nothing was deleted, and you can export it at any time.',
        cta: 'Choose a plan',
    }
}
