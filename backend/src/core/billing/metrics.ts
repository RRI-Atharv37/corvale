import type { BillingInterval, GrandfatherKind, PlanCode, SubscriptionStatus } from './constants'

/**
 * M7b - the flow counters the metrics table (plan §7) defines, and the stock/MRR/churn/LTV math built
 * on them. Pure and framework-agnostic: no Mongoose here, so it is unit-testable the same way `shared/`
 * is, and the one place both `metricDaily.model.ts` (storage) and `metrics.service.ts` (DB writes) agree
 * on the shape.
 */

export const METRIC_FLOW_FIELDS = [
    'signups',
    'trialStarted',
    'trialConverted',
    'trialExpired',
    'newPaid',
    'newMrr',
    'expansionMrr',
    'contractionMrr',
    'churnedVoluntary',
    'churnedInvoluntary',
    'churnedMrr',
    'refunds',
    'refundMinor',
    'disputes',
    'pastDueEntered',
    'dunningRecovered',
] as const
export type MetricFlowField = (typeof METRIC_FLOW_FIELDS)[number]

export type MetricFlows = Record<MetricFlowField, number>

export const ZERO_FLOWS: MetricFlows = Object.fromEntries(METRIC_FLOW_FIELDS.map((field) => [field, 0])) as MetricFlows

export interface MetricStockSegment {
    planCode: PlanCode
    status: SubscriptionStatus
    interval: BillingInterval | null
    grandfatherKind: GrandfatherKind | null
    count: number
}

export interface MetricStock {
    asOf: Date
    segments: MetricStockSegment[]
    /** Minor units of a single reporting currency (list price, not what any one payer's own currency shows). */
    listPriceMrrMinor: number
    atRiskMrrMinor: number
}

/** Every bucket is a UTC calendar day (D13) - never local-timezone bucketing. */
export const dateKeyUtc = (date: Date): string => date.toISOString().slice(0, 10)

export interface PlanPrices {
    monthly: number | null
    annual: number | null
}

/** Monthly-equivalent list price of one subscription: annual is divided by 12, never counted at its face value. */
export const planMrrMinor = (prices: PlanPrices, interval: BillingInterval | null): number => {
    if (interval === 'annual') return prices.annual !== null ? Math.round(prices.annual / 12) : 0
    return prices.monthly ?? 0
}

const MRR_STATUSES: readonly SubscriptionStatus[] = ['active', 'past_due']

/**
 * List-price MRR of every provider-linked `active`/`past_due` segment, split out `past_due` as at-risk.
 * Excludes `free_forever` (never bought). The caller (the snapshot step) is responsible for excluding
 * comp/override rows before grouping into segments - that lives on `Subscription.adminGrant`, which is
 * not part of a stock segment's shape.
 */
export const calculateMrr = (segments: MetricStockSegment[], prices: Record<string, PlanPrices>): { listPriceMrrMinor: number; atRiskMrrMinor: number } => {
    let listPriceMrrMinor = 0
    let atRiskMrrMinor = 0

    for (const segment of segments) {
        if (segment.grandfatherKind === 'free_forever') continue
        if (!MRR_STATUSES.includes(segment.status)) continue

        const planPrices = prices[segment.planCode]
        if (!planPrices) continue

        const total = planMrrMinor(planPrices, segment.interval) * segment.count
        listPriceMrrMinor += total
        if (segment.status === 'past_due') atRiskMrrMinor += total
    }

    return { listPriceMrrMinor, atRiskMrrMinor }
}

export const sumFlows = (flowsList: MetricFlows[]): MetricFlows => {
    const total: MetricFlows = { ...ZERO_FLOWS }
    for (const flows of flowsList) {
        for (const field of METRIC_FLOW_FIELDS) total[field] += flows[field] ?? 0
    }
    return total
}

/** Provider-linked, currently paying (active or past_due), excluding `free_forever` - never bought. */
export const payingSubscriberCount = (segments: MetricStockSegment[]): number =>
    segments.filter((segment) => MRR_STATUSES.includes(segment.status) && segment.grandfatherKind !== 'free_forever').reduce((sum, segment) => sum + segment.count, 0)

export const calculateArpa = (mrrMinor: number, payingSubscribers: number): number | null =>
    payingSubscribers > 0 ? mrrMinor / payingSubscribers : null

export const calculateLogoChurn = (churnedCount: number, payingAtPeriodStart: number): number | null =>
    payingAtPeriodStart > 0 ? churnedCount / payingAtPeriodStart : null

export const calculateRevenueChurn = (churnedMrrMinor: number, contractionMrrMinor: number, startingMrrMinor: number): number | null =>
    startingMrrMinor > 0 ? (churnedMrrMinor + contractionMrrMinor) / startingMrrMinor : null

export const calculateTrialConversionRate = (converted: number, expired: number): number | null => {
    const ended = converted + expired
    return ended > 0 ? converted / ended : null
}

export const calculateDunningRecoveryRate = (recovered: number, entered: number): number | null => (entered > 0 ? recovered / entered : null)

// -------- LTV (D13) --------

export const LTV_CAP_MONTHS = 36
const LTV_MIN_WINDOW_DAYS = 90
const LTV_MIN_CHURN_EVENTS = 30
const Z_95 = 1.96

export interface LtvInput {
    /** ARPA net of the MoR's fee, minor units. */
    arpaNetMinor: number
    /** Churn events in the trailing window. */
    churnEvents: number
    /** Subscribers at risk of churn in that window (the denominator of the churn rate). */
    subscribersAtRisk: number
    windowDays: number
}

export type LtvStatus = 'ok' | 'capped' | 'insufficient_data'

export interface LtvResult {
    status: LtvStatus
    /** Never a realised figure - always this model's output. Null only when insufficient_data. */
    ltvMinor: number | null
    lowMinor: number | null
    highMinor: number | null
    churnRate: number | null
    churnEvents: number
    subscribersAtRisk: number
}

/**
 * `LTV_est = ARPA_net x min(1/c, 36 months)`. Shown only with >=90 days of data and >=30 churn events for
 * the segment; a near-zero churn rate is tagged "capped" (churn too low to measure) rather than exploding
 * toward infinity. The low/high band is a 95% binomial interval on `c` (normal approximation), so a small
 * sample reads as wide, not falsely precise.
 */
export const calculateEstimatedLtv = (input: LtvInput): LtvResult => {
    const base = { churnEvents: input.churnEvents, subscribersAtRisk: input.subscribersAtRisk }

    if (input.windowDays < LTV_MIN_WINDOW_DAYS || input.churnEvents < LTV_MIN_CHURN_EVENTS || input.subscribersAtRisk <= 0) {
        return { status: 'insufficient_data', ltvMinor: null, lowMinor: null, highMinor: null, churnRate: null, ...base }
    }

    const c = input.churnEvents / input.subscribersAtRisk

    if (c <= 0 || c < 1 / LTV_CAP_MONTHS) {
        return { status: 'capped', ltvMinor: Math.round(input.arpaNetMinor * LTV_CAP_MONTHS), lowMinor: null, highMinor: null, churnRate: c, ...base }
    }

    const months = Math.min(1 / c, LTV_CAP_MONTHS)
    const se = Math.sqrt((c * (1 - c)) / input.subscribersAtRisk)
    const lowC = Math.max(c - Z_95 * se, 1e-6)
    const highC = c + Z_95 * se

    return {
        status: months >= LTV_CAP_MONTHS ? 'capped' : 'ok',
        ltvMinor: Math.round(input.arpaNetMinor * months),
        lowMinor: Math.round(input.arpaNetMinor * Math.min(1 / highC, LTV_CAP_MONTHS)),
        highMinor: Math.round(input.arpaNetMinor * Math.min(1 / lowC, LTV_CAP_MONTHS)),
        churnRate: c,
        ...base,
    }
}
