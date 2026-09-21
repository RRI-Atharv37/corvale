import { RLS_BYPASS } from '@core/access/rowLevelSecurity'
import { captureException } from '@infra/observability/errorTracking'
import { logger } from '@infra/observability/logger'

import { isBillingEnabled } from './entitlement.service'
import type { BillingProvider, ProviderSubscriptionSnapshot } from './providers/billingProvider'
import { getBillingProvider } from './providers/providerRegistry'
import Subscription, { type ISubscription } from './subscription.model'

export type DriftKind = 'missing_locally' | 'missing_at_provider' | 'field_mismatch'

export interface DriftItem {
    kind: DriftKind
    providerSubscriptionId: string
    fields?: string[]
}

export interface ReconciliationReport {
    skipped: boolean
    checked: number
    drift: DriftItem[]
    /** Differences withheld because the provider changed the subscription so recently its webhook may still be on the way. */
    deferred: number
}

export interface ReconcileOptions {
    provider?: BillingProvider
    now?: Date
    inFlightWindowMs?: number
}

export const DEFAULT_IN_FLIGHT_WINDOW_MS = 15 * 60 * 1000
const MAX_ALERT_ITEMS = 50

// Runs from a script with no request context, so the query opts out of RLS explicitly.
const BYPASS = { [RLS_BYPASS]: true }

const timeOf = (value: Date | null | undefined): number | null => (value ? value.getTime() : null)

/** A field the provider did not state is never compared: absence is not evidence of a change. */
const differingFields = (local: ISubscription, remote: ProviderSubscriptionSnapshot): string[] => {
    const fields: string[] = []

    if (remote.status !== undefined && local.status !== remote.status) fields.push('status')
    if (remote.planCode != null && local.planCode !== remote.planCode) fields.push('planCode')
    if (remote.currentPeriodEnd !== undefined && timeOf(local.currentPeriodEnd) !== timeOf(remote.currentPeriodEnd)) {
        fields.push('currentPeriodEnd')
    }
    if (remote.trialEndsAt !== undefined && timeOf(local.trialEndsAt) !== timeOf(remote.trialEndsAt)) fields.push('trialEndsAt')
    if (remote.cancelAtPeriodEnd !== undefined && local.cancelAtPeriodEnd !== remote.cancelAtPeriodEnd) {
        fields.push('cancelAtPeriodEnd')
    }
    if (remote.providerCustomerId !== undefined && local.providerCustomerId !== remote.providerCustomerId) {
        fields.push('providerCustomerId')
    }

    return fields
}

const alertOnDrift = (drift: DriftItem[], deferred: number): void => {
    const byKind: Partial<Record<DriftKind, number>> = {}
    for (const item of drift) byKind[item.kind] = (byKind[item.kind] ?? 0) + 1

    // Provider ids and counts only: the alert leaves the database, and the user id never needs to.
    const context = { driftCount: drift.length, byKind, deferred, items: drift.slice(0, MAX_ALERT_ITEMS) }
    logger.error('Billing drift detected between the provider and local subscriptions', context)
    captureException(new Error('Billing reconciliation found drift'), context)
}

/**
 * Diffs the provider's subscription list against the local rows that carry a provider link, and
 * alerts on any difference. Detect-and-report only: nothing is written, because choosing the
 * listing over the webhook history is a decision for whoever reads the alert.
 */
export const reconcileBillingSubscriptions = async (options: ReconcileOptions = {}): Promise<ReconciliationReport> => {
    if (!isBillingEnabled()) return { skipped: true, checked: 0, drift: [], deferred: 0 }

    const now = options.now ?? new Date()
    const windowMs = options.inFlightWindowMs ?? DEFAULT_IN_FLIGHT_WINDOW_MS
    const inFlight = (remote: ProviderSubscriptionSnapshot): boolean => now.getTime() - remote.updatedAt.getTime() < windowMs

    let snapshots: ProviderSubscriptionSnapshot[]
    try {
        snapshots = await (options.provider ?? getBillingProvider()).listSubscriptions()
    } catch (error) {
        logger.error('Billing reconciliation could not read the provider', { reason: (error as Error).message })
        captureException(error, { stage: 'billing-reconciliation' })
        throw error
    }

    const unmatched = new Map(snapshots.map((snapshot) => [snapshot.providerSubscriptionId, snapshot]))
    const linked = await Subscription.find({ providerSubscriptionId: { $type: 'string' } })
        .setOptions(BYPASS)
        .lean<ISubscription[]>()

    const drift: DriftItem[] = []
    let deferred = 0

    for (const local of linked) {
        const providerSubscriptionId = local.providerSubscriptionId as string
        const remote = unmatched.get(providerSubscriptionId)

        if (!remote) {
            if (local.status !== 'cancelled') drift.push({ kind: 'missing_at_provider', providerSubscriptionId })
            continue
        }
        unmatched.delete(providerSubscriptionId)

        const fields = differingFields(local, remote)
        if (fields.length === 0) continue
        if (inFlight(remote)) deferred += 1
        else drift.push({ kind: 'field_mismatch', providerSubscriptionId, fields })
    }

    for (const remote of unmatched.values()) {
        if (inFlight(remote)) deferred += 1
        else drift.push({ kind: 'missing_locally', providerSubscriptionId: remote.providerSubscriptionId })
    }

    if (drift.length > 0) alertOnDrift(drift, deferred)

    return { skipped: false, checked: linked.length + unmatched.size, drift, deferred }
}
