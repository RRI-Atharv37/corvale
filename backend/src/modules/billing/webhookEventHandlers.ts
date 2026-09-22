import { Types } from 'mongoose'

import { RLS_BYPASS } from '@core/access/rowLevelSecurity'
import { PLAN_CODES, SUBSCRIPTION_STATUSES, type PlanCode } from '@core/billing/constants'
import { isDuplicateKeyError } from '@core/db/objectId'
import { logger } from '@infra/observability/logger'
import { User } from '@modules/users'

import { recordSubscriptionTransitionMetrics, recordTransitionMetrics } from './metrics.service'
import { KNOWN_BILLING_EVENT_TYPES, type KnownBillingEventType, type NormalizedBillingEvent } from './providers/billingProvider'
import Subscription, { type ISubscription } from './subscription.model'

export type BillingEventOutcome = { status: 'applied' } | { status: 'unapplied'; reason: string }

export type BillingEventHandler = (event: NormalizedBillingEvent) => Promise<BillingEventOutcome>

const APPLIED: BillingEventOutcome = { status: 'applied' }
const unapplied = (reason: string): BillingEventOutcome => ({ status: 'unapplied', reason })

// Handlers run outside any request context, so every Subscription query opts out of RLS explicitly.
const BYPASS = { [RLS_BYPASS]: true }

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i

const asObjectId = (value: string | undefined): Types.ObjectId | null =>
    value !== undefined && OBJECT_ID_PATTERN.test(value) ? new Types.ObjectId(value) : null

const validationProblem = (event: NormalizedBillingEvent): string | null => {
    if (event.planCode != null && !(PLAN_CODES as readonly string[]).includes(event.planCode)) {
        return `Plan ${event.planCode} is not in the catalogue`
    }
    if (event.status !== undefined && !SUBSCRIPTION_STATUSES.includes(event.status)) {
        return `Status ${String(event.status)} is not a known subscription status`
    }
    return null
}

const findByProviderIds = async (event: NormalizedBillingEvent): Promise<ISubscription | null> => {
    if (event.providerSubscriptionId) {
        const bySubscription = await Subscription.findOne({ providerSubscriptionId: event.providerSubscriptionId }).setOptions(BYPASS)
        if (bySubscription) return bySubscription
    }
    if (event.providerCustomerId) {
        return Subscription.findOne({ providerCustomerId: event.providerCustomerId }).setOptions(BYPASS)
    }
    return null
}

/**
 * The newest event time is the ordering key: an event older than the last one applied is stale and
 * changes nothing (it is still settled as applied, since retrying it can never help). The filter
 * repeats the check so a concurrent newer event wins the race.
 */
const applyChanges = async (
    row: ISubscription,
    event: NormalizedBillingEvent,
    changes: Record<string, unknown>
): Promise<BillingEventOutcome> => {
    if (row.lastEventAt && row.lastEventAt.getTime() > event.occurredAt.getTime()) return APPLIED

    let updated: ISubscription | null
    try {
        updated = await Subscription.findOneAndUpdate(
            { _id: row._id, $or: [{ lastEventAt: null }, { lastEventAt: { $lte: event.occurredAt } }] },
            { $set: { ...changes, lastEventAt: event.occurredAt } }
        ).setOptions(BYPASS)
    } catch (error) {
        if (isDuplicateKeyError(error)) return unapplied('Provider id is already linked to another subscription')
        throw error
    }
    if (updated) await recordSubscriptionTransitionMetrics(row, changes, event.providerEventId, event.occurredAt)
    return APPLIED
}

/**
 * `resubscribe` lets a creation event move the provider link, but only off a subscription that has
 * already ended: a cancelled row is finished, so the user's new checkout is their subscription now.
 * Any other state keeps its link - the provider ids of a live subscription never move.
 */
const subscriptionChanges = (
    row: ISubscription | null,
    event: NormalizedBillingEvent,
    resubscribe = false
): Record<string, unknown> => {
    const changes: Record<string, unknown> = {}
    const relink = resubscribe && row?.status === 'cancelled'

    if (event.planCode) changes.planCode = event.planCode
    if (event.interval !== undefined) changes.interval = event.interval
    if (event.status) {
        changes.status = event.status
        changes.pastDueSince = event.status === 'past_due' ? (row?.pastDueSince ?? event.occurredAt) : null
        if (event.status !== 'past_due') changes.dunningStage = null
    }
    if (event.currentPeriodEnd !== undefined) changes.currentPeriodEnd = event.currentPeriodEnd
    if (event.trialEndsAt !== undefined) changes.trialEndsAt = event.trialEndsAt
    if (event.cancelAtPeriodEnd !== undefined) changes.cancelAtPeriodEnd = event.cancelAtPeriodEnd
    if (event.providerCustomerId && (relink || !row?.providerCustomerId)) changes.providerCustomerId = event.providerCustomerId
    if (event.providerSubscriptionId && (relink || !row?.providerSubscriptionId)) changes.providerSubscriptionId = event.providerSubscriptionId

    return changes
}

const NO_MATCH = 'No subscription matches this event'

/**
 * `userId` only ever links a subscription that has no provider link yet, and only when the user
 * exists; a subscription already known by its provider ids is updated regardless of what the event
 * says about the user.
 */
const handleSubscriptionCreated: BillingEventHandler = async (event) => {
    const problem = validationProblem(event)
    if (problem) return unapplied(problem)

    const known = await findByProviderIds(event)
    if (known) return applyChanges(known, event, subscriptionChanges(known, event, true))

    const userId = asObjectId(event.userId)
    if (!userId) return unapplied(NO_MATCH)

    const byUser = await Subscription.findOne({ userId }).setOptions(BYPASS)
    if (byUser) {
        if ((byUser.providerSubscriptionId || byUser.providerCustomerId) && byUser.status !== 'cancelled') {
            return unapplied('User is already linked to a different provider subscription')
        }
        return applyChanges(byUser, event, subscriptionChanges(byUser, event, true))
    }

    if (!(await User.exists({ _id: userId }))) return unapplied('No user matches this event')
    if (!event.planCode || !event.status) return unapplied('Event carries no plan and status to grant')

    try {
        await Subscription.create({
            userId,
            planCode: event.planCode as PlanCode,
            interval: event.interval ?? null,
            status: event.status,
            trialEndsAt: event.trialEndsAt ?? null,
            currentPeriodEnd: event.currentPeriodEnd ?? null,
            cancelAtPeriodEnd: event.cancelAtPeriodEnd ?? false,
            pastDueSince: event.status === 'past_due' ? event.occurredAt : null,
            providerCustomerId: event.providerCustomerId ?? null,
            providerSubscriptionId: event.providerSubscriptionId ?? null,
            lastEventAt: event.occurredAt,
        })
    } catch (error) {
        if (isDuplicateKeyError(error)) return unapplied('A subscription for this user was created concurrently')
        throw error
    }
    await recordSubscriptionTransitionMetrics(
        null,
        { status: event.status, planCode: event.planCode as PlanCode, interval: event.interval ?? null },
        event.providerEventId,
        event.occurredAt
    )
    return APPLIED
}

const handleSubscriptionUpdated: BillingEventHandler = async (event) => {
    const problem = validationProblem(event)
    if (problem) return unapplied(problem)

    const row = await findByProviderIds(event)
    if (!row) return unapplied(NO_MATCH)
    return applyChanges(row, event, subscriptionChanges(row, event))
}

const handleSubscriptionDeleted: BillingEventHandler = async (event) => {
    const row = await findByProviderIds(event)
    if (!row) return unapplied(NO_MATCH)
    return applyChanges(row, event, { status: 'cancelled', pastDueSince: null, dunningStage: null })
}

const DUNNING_STATES: readonly string[] = ['active', 'past_due']

const handlePaymentFailed: BillingEventHandler = async (event) => {
    const row = await findByProviderIds(event)
    if (!row) return unapplied(NO_MATCH)
    if (!DUNNING_STATES.includes(row.status)) return APPLIED

    return applyChanges(row, event, { status: 'past_due', pastDueSince: row.pastDueSince ?? event.occurredAt })
}

const handlePaymentSucceeded: BillingEventHandler = async (event) => {
    const row = await findByProviderIds(event)
    if (!row) return unapplied(NO_MATCH)
    if (!DUNNING_STATES.includes(row.status)) return APPLIED

    const changes: Record<string, unknown> = { status: 'active', pastDueSince: null, dunningStage: null }
    if (event.currentPeriodEnd !== undefined) changes.currentPeriodEnd = event.currentPeriodEnd
    return applyChanges(row, event, changes)
}

// Recorded on the ledger and logged for a human; whether either revokes access is a policy call for later.
const handleRefundIssued: BillingEventHandler = async (event) => {
    logger.warn('Billing refund issued', { providerEventId: event.providerEventId, providerSubscriptionId: event.providerSubscriptionId })
    const total = typeof event.payload?.total === 'number' ? event.payload.total : 0
    await recordTransitionMetrics(event.providerEventId, event.occurredAt, { refunds: 1, refundMinor: total })
    return APPLIED
}

const handleDisputeOpened: BillingEventHandler = async (event) => {
    logger.warn('Billing dispute opened', { providerEventId: event.providerEventId, providerSubscriptionId: event.providerSubscriptionId })
    await recordTransitionMetrics(event.providerEventId, event.occurredAt, { disputes: 1 })
    return APPLIED
}

const HANDLERS: Record<KnownBillingEventType, BillingEventHandler> = {
    'checkout.completed': handleSubscriptionCreated,
    'subscription.created': handleSubscriptionCreated,
    'subscription.updated': handleSubscriptionUpdated,
    'subscription.deleted': handleSubscriptionDeleted,
    'payment.succeeded': handlePaymentSucceeded,
    'payment.failed': handlePaymentFailed,
    'refund.issued': handleRefundIssued,
    'dispute.opened': handleDisputeOpened,
}

const isKnownEventType = (type: string): type is KnownBillingEventType =>
    (KNOWN_BILLING_EVENT_TYPES as readonly string[]).includes(type)

export const applyBillingEvent: BillingEventHandler = async (event) => {
    if (!isKnownEventType(event.type)) return APPLIED

    return HANDLERS[event.type](event)
}
