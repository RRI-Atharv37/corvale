import { Types } from 'mongoose'

import type { UsageResource } from '@core/billing/constants'
import { MAX_PAST_DUE_GRACE_DAYS, MIN_PAST_DUE_GRACE_DAYS } from '@core/billing/dunning'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { buildEntitlementSnapshot, type EntitlementSnapshot } from '@core/billing/entitlementSnapshot'
import { Workspace } from '@modules/workspaces'
import {
    DEFAULT_PAST_DUE_GRACE_DAYS,
    UNLIMITED_ENTITLEMENTS,
    cloneEntitlements,
    resolveEntitlements,
    type Entitlements,
    type PlanDefinition,
    type SubscriptionSnapshot,
} from '@core/billing/entitlements'

import { DEFAULT_PLAN_CATALOGUE } from './planCatalogue'
import Plan from './plan.model'
import Subscription from './subscription.model'
import UsageCounter from './usageCounter.model'

export const isBillingEnabled = (): boolean => process.env.BILLING_ENABLED === 'true'

export const getPastDueGraceDays = (): number => {
    const configured = Number(process.env.BILLING_PAST_DUE_GRACE_DAYS)
    return Number.isInteger(configured) && configured >= MIN_PAST_DUE_GRACE_DAYS && configured <= MAX_PAST_DUE_GRACE_DAYS
        ? configured
        : DEFAULT_PAST_DUE_GRACE_DAYS
}

const loadPlanDefinition = async (code: SubscriptionSnapshot['planCode']): Promise<PlanDefinition | null> => {
    const plan = await Plan.findOne({ code }).lean()
    if (plan) return { code: plan.code, features: plan.features, limits: plan.limits }

    // An unseeded catalogue must not turn every paying user read-only or unlimited.
    const fallback = DEFAULT_PLAN_CATALOGUE.find((entry) => entry.code === code)
    return fallback ? { code: fallback.code, features: fallback.features, limits: fallback.limits } : null
}

/**
 * Read fresh on every call - no cache, so an upgrade, downgrade or webhook-applied change is
 * honoured by the very next request. `now` is injectable for tests and the expiry sweeps.
 */
const loadEntitlementState = async (
    userId: string,
    now: Date
): Promise<{ entitlements: Entitlements; subscription: SubscriptionSnapshot | null }> => {
    if (!isBillingEnabled()) return { entitlements: cloneEntitlements(UNLIMITED_ENTITLEMENTS), subscription: null }

    const subscription = await Subscription.findOne({ userId }).lean()
    if (!subscription) return { entitlements: resolveEntitlements(null, null, now), subscription: null }

    const plan = await loadPlanDefinition(subscription.planCode)
    return {
        entitlements: resolveEntitlements(subscription, plan, now, { pastDueGraceDays: getPastDueGraceDays() }),
        subscription,
    }
}

export const getUserEntitlements = async (userId: string, now: Date = new Date()): Promise<Entitlements> =>
    (await loadEntitlementState(userId, now)).entitlements

/** The shape the client caches on the user payload (M2d). Always the caller's own plan. */
export const getUserEntitlementSnapshot = async (userId: string, now: Date = new Date()): Promise<EntitlementSnapshot> => {
    const { entitlements, subscription } = await loadEntitlementState(userId, now)
    return buildEntitlementSnapshot(entitlements, subscription, now)
}

export const getWorkspaceOwnerId = async (workspaceId: string): Promise<string> => {
    const workspace = Types.ObjectId.isValid(workspaceId)
        ? await Workspace.findById(workspaceId).select('ownerId').lean()
        : null
    if (!workspace) throw new CustomError(ERROR_MESSAGES.WORKSPACE.WORKSPACE_NOT_FOUND, 404)
    return workspace.ownerId.toString()
}

/** A workspace runs on its owner's plan; a member's own subscription never enters into it. */
export const getWorkspaceEntitlements = async (workspaceId: string, now: Date = new Date()): Promise<Entitlements> => {
    if (!isBillingEnabled()) return cloneEntitlements(UNLIMITED_ENTITLEMENTS)

    return getUserEntitlements(await getWorkspaceOwnerId(workspaceId), now)
}

export const getUsage = async (userId: string, resource: UsageResource): Promise<number> => {
    const counter = await UsageCounter.findOne({ userId, resource }).lean()
    return counter?.value ?? 0
}
