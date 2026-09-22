/**
 * M8f - pure payout-variance math. No Mongoose, no wall-clock reads: given what the MoR reported
 * paying out for a period and what Corvale separately recognized as local revenue for that same
 * period (M8e's ledger for annual plans, plus monthly-plan payments recognized immediately), compute
 * the gap and whether it is worth a human's attention.
 *
 * The two figures are not expected to match exactly - a payout is net of the MoR's own fee (an indie
 * MoR's take runs roughly 4-10%, see ROADMAP.md's provider table) plus any refund/chargeback the MoR
 * settled directly against the payout rather than as a separate `refund.issued` webhook.
 * `DEFAULT_VARIANCE_TOLERANCE_PERCENT` sits above that normal fee range so a routine payout stays
 * unflagged and only a genuine anomaly - a missed payout, a double-counted recognition, a provider
 * outage - surfaces.
 */

export const DEFAULT_VARIANCE_TOLERANCE_PERCENT = 15

export interface PayoutVariance {
    varianceMinor: number
    variancePercent: number
    flagged: boolean
}

/**
 * `variancePercent` is signed and relative to `localRevenueMinor` (negative = the payout came in
 * below local revenue, as expected once the MoR's fee is netted out; positive = above, which a fee
 * deduction alone never explains). When local revenue is zero there is nothing to take a percentage
 * of: a nonzero payout against zero recorded revenue is always flagged, a zero payout against zero
 * revenue is unremarkable.
 */
export const computePayoutVariance = (
    reportedPayoutMinor: number,
    localRevenueMinor: number,
    tolerancePercent: number = DEFAULT_VARIANCE_TOLERANCE_PERCENT
): PayoutVariance => {
    const varianceMinor = reportedPayoutMinor - localRevenueMinor

    if (localRevenueMinor === 0) {
        return { varianceMinor, variancePercent: reportedPayoutMinor === 0 ? 0 : 100, flagged: reportedPayoutMinor !== 0 }
    }

    const variancePercent = (varianceMinor / localRevenueMinor) * 100
    return { varianceMinor, variancePercent, flagged: Math.abs(variancePercent) > tolerancePercent }
}
