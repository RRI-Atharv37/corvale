import { GRANDFATHER_KINDS, PLAN_CODES, SUBSCRIPTION_STATUSES } from '@core/billing/constants'
import { DUNNING_STAGES } from '@core/billing/dunning'
import { RETENTION_STAGES } from '@core/billing/retention'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

const invalid = (): CustomError => new CustomError(ERROR_MESSAGES.ADMIN.INVALID_QUERY, 400)

/** A query parameter must be exactly one non-empty string; repeated parameters and bracketed operators are refused. */
export const singleString = (value: unknown): string | undefined => {
    if (value === undefined) return undefined
    if (typeof value !== 'string' || value === '') throw invalid()
    return value
}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined => {
    const raw = singleString(value)
    if (raw === undefined) return undefined
    if (!(allowed as readonly string[]).includes(raw)) throw invalid()
    return raw as T
}

const boolean = (value: unknown): boolean | undefined => {
    const raw = singleString(value)
    if (raw === undefined) return undefined
    if (raw !== 'true' && raw !== 'false') throw invalid()
    return raw === 'true'
}

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_TRIAL_WINDOW_DAYS = 365

const wholeDays = (value: unknown): number | undefined => {
    const raw = singleString(value)
    if (raw === undefined) return undefined
    if (!/^\d+$/.test(raw)) throw invalid()

    const days = Number(raw)
    if (days > MAX_TRIAL_WINDOW_DAYS) throw invalid()
    return days
}

/**
 * Only fixed filters: no free-text or substring search exists, so the list cannot be used to harvest addresses.
 * Returns a Mongo filter built from validated enums and numbers only.
 */
export const buildSubscriberFilter = (query: Record<string, unknown>, now: Date): Record<string, unknown> => {
    const filter: Record<string, unknown> = {}

    const status = oneOf(query.status, SUBSCRIPTION_STATUSES)
    if (status) filter.status = status

    const plan = oneOf(query.plan, PLAN_CODES)
    if (plan) filter.planCode = plan

    const grandfatherKind = oneOf(query.grandfatherKind, GRANDFATHER_KINDS)
    if (grandfatherKind) filter.grandfatherKind = grandfatherKind

    const dunningStage = oneOf(query.dunningStage, DUNNING_STAGES)
    if (dunningStage) filter.dunningStage = dunningStage

    const retentionStage = oneOf(query.retentionStage, RETENTION_STAGES)
    if (retentionStage) filter.retentionStage = retentionStage

    const providerLinked = boolean(query.providerLinked)
    if (providerLinked === true) filter.providerSubscriptionId = { $type: 'string' }
    if (providerLinked === false) filter.providerSubscriptionId = null

    const hasAdminGrant = boolean(query.hasAdminGrant)
    if (hasAdminGrant === true) filter['adminGrant.until'] = { $gt: now }
    if (hasAdminGrant === false) filter.$nor = [{ 'adminGrant.until': { $gt: now } }]

    const trialEndingWithinDays = wholeDays(query.trialEndingWithinDays)
    if (trialEndingWithinDays !== undefined) {
        filter.status = 'trialing'
        filter.trialEndsAt = { $gt: now, $lte: new Date(now.getTime() + trialEndingWithinDays * DAY_MS) }
    }

    return filter
}
