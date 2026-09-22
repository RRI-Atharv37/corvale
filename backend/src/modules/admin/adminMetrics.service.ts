import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import {
    calculateArpa,
    calculateDunningRecoveryRate,
    calculateEstimatedLtv,
    calculateLogoChurn,
    calculateRevenueChurn,
    calculateTrialConversionRate,
    dateKeyUtc,
    payingSubscriberCount,
    sumFlows,
} from '@core/billing/metrics'

import { findMetricDailyRange } from './adminData.service'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_WINDOW_DAYS = 30
const MIN_WINDOW_DAYS = 1
const MAX_WINDOW_DAYS = 365

const parseWindowDays = (value: unknown): number => {
    if (value === undefined) return DEFAULT_WINDOW_DAYS
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < MIN_WINDOW_DAYS || parsed > MAX_WINDOW_DAYS) {
        throw new CustomError(ERROR_MESSAGES.ADMIN.INVALID_QUERY, 400)
    }
    return parsed
}

/**
 * Reads what `snapshotMetricsStock` (the last step of `runBillingSweeps`, M7b.2) and the flow counters
 * (M7b.1) have already written - no computation touches live `Subscription` rows here, only `MetricDaily`.
 * All windows and buckets are UTC calendar days (D13); the dashboard (M7b.3) labels every axis so.
 */
export const getMetricsOverview = async (query: { days?: unknown }, now: Date = new Date()) => {
    const windowDays = parseWindowDays(query.days)
    const since = dateKeyUtc(new Date(now.getTime() - (windowDays - 1) * DAY_MS))
    const today = dateKeyUtc(now)

    const docs = await findMetricDailyRange(since, today)
    const flows = sumFlows(docs.map((doc) => doc.flows))
    const docsWithStock = docs.filter((doc) => doc.stock !== null)
    const latestStock = docsWithStock.length > 0 ? docsWithStock[docsWithStock.length - 1].stock : null

    const payingSubscribers = latestStock ? payingSubscriberCount(latestStock.segments) : 0
    const arpaMinor = latestStock ? calculateArpa(latestStock.listPriceMrrMinor, payingSubscribers) : null
    const churnEvents = flows.churnedVoluntary + flows.churnedInvoluntary

    return {
        windowDays,
        generatedAt: now,
        flows,
        stock: latestStock
            ? {
                  asOf: latestStock.asOf,
                  segments: latestStock.segments,
                  listPriceMrrMinor: latestStock.listPriceMrrMinor,
                  atRiskMrrMinor: latestStock.atRiskMrrMinor,
                  payingSubscribers,
                  arpaMinor,
              }
            : null,
        rates: {
            logoChurn: calculateLogoChurn(churnEvents, payingSubscribers),
            revenueChurn: calculateRevenueChurn(flows.churnedMrr, flows.contractionMrr, latestStock?.listPriceMrrMinor ?? 0),
            trialConversionRate: calculateTrialConversionRate(flows.trialConverted, flows.trialExpired),
            dunningRecoveryRate: calculateDunningRecoveryRate(flows.dunningRecovered, flows.pastDueEntered),
        },
        // ARPA is list price, not net of the MoR's fee - an honest input until M0 picks the MoR and its fee is known.
        ltv: calculateEstimatedLtv({ arpaNetMinor: arpaMinor ?? 0, churnEvents, subscribersAtRisk: payingSubscribers, windowDays }),
        dataQuality: { daysRequested: windowDays, daysWithStock: docsWithStock.length },
    }
}
