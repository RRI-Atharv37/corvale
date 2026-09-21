import { FEATURE_KEYS, LIMIT_KEYS, type LimitKey, type PlanCode } from './constants'
import type { AdminGrantSnapshot, Entitlements, PlanDefinition } from './entitlements'

/** Plans in ascending order of what they include. */
const PLAN_RANK: Record<PlanCode, number> = { plus: 1, pro: 2 }

export const isAdminGrantActive = (grant: { until: Date } | null | undefined, now: Date): boolean =>
    !!grant && grant.until.getTime() > now.getTime()

const higherPlan = (a: PlanCode | null, b: PlanCode | null | undefined): PlanCode | null => {
    if (!b) return a
    if (!a) return b
    return PLAN_RANK[b] > PLAN_RANK[a] ? b : a
}

/** `null` is unlimited and beats any number; a missing value leaves the limit as it was. */
const higherLimit = (current: number | null, incoming: number | null | undefined): number | null => {
    if (incoming === undefined) return current
    if (current === null || incoming === null) return null
    return Math.max(current, incoming)
}

const raiseLimits = (
    current: Record<LimitKey, number | null>,
    ...sources: (Partial<Record<LimitKey, number | null>> | null | undefined)[]
): Record<LimitKey, number | null> => {
    const out = { ...current }
    for (const source of sources) {
        if (!source) continue
        for (const key of LIMIT_KEYS) out[key] = higherLimit(out[key], source[key])
    }
    return out
}

/**
 * Layers a staff grant over the provider-owned verdict. It only ever adds: the better plan, the larger limit,
 * the extra feature. A comp additionally makes a read-only account writable; an override never does, because
 * lifting a read-only state is a different decision. Expiry comes from the clock, like a trial's.
 */
export const applyAdminGrant = (
    base: Entitlements,
    grant: AdminGrantSnapshot | null | undefined,
    grantPlan: PlanDefinition | null,
    now: Date
): Entitlements => {
    if (!grant || !isAdminGrantActive(grant, now)) return base
    if (grant.kind === 'plan_override' && !base.canWrite) return base

    const lifts = grant.kind === 'comp' && !base.canWrite
    const features = { ...base.features }
    for (const key of FEATURE_KEYS) features[key] = features[key] || grantPlan?.features[key] === true

    return {
        ...base,
        status: lifts ? 'active' : base.status,
        planCode: higherPlan(base.planCode, grant.planCode),
        canWrite: base.canWrite || lifts,
        canSyncPush: base.canSyncPush || lifts,
        graceEndsAt: lifts ? null : base.graceEndsAt,
        features,
        limits: raiseLimits(base.limits, grantPlan?.limits, grant.limits),
    }
}

/**
 * True when the grant would raise something the customer's own plan does not already give: a higher plan, or
 * any limit above the plan's (unlimited counts as the highest). An override that lowers or merely matches is
 * refused, so it can never be used as a covert downgrade.
 */
export const isPlanUpgrade = (
    grant: { planCode?: PlanCode | null; limits?: Partial<Record<LimitKey, number | null>> | null },
    basePlan: PlanDefinition
): boolean => {
    if (grant.planCode && PLAN_RANK[grant.planCode] > PLAN_RANK[basePlan.code]) return true

    for (const key of LIMIT_KEYS) {
        const requested = grant.limits?.[key]
        if (requested === undefined) continue

        const current = basePlan.limits[key]
        if (current === null) continue
        if (requested === null || requested > current) return true
    }
    return false
}
