import type { UsageResource } from '@core/billing/constants'
import {
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
export const getUserEntitlements = async (userId: string, now: Date = new Date()): Promise<Entitlements> => {
    if (!isBillingEnabled()) return cloneEntitlements(UNLIMITED_ENTITLEMENTS)

    const subscription = await Subscription.findOne({ userId }).lean()
    if (!subscription) return resolveEntitlements(null, null, now)

    const plan = await loadPlanDefinition(subscription.planCode)
    return resolveEntitlements(subscription, plan, now)
}

export const getUsage = async (userId: string, resource: UsageResource): Promise<number> => {
    const counter = await UsageCounter.findOne({ userId, resource }).lean()
    return counter?.value ?? 0
}
