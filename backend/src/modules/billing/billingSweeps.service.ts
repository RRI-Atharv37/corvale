import { expireLapsedTrials } from './trial.service'
import { sendDunningEmails, type DunningSweepResult } from './dunning.service'
import { isBillingEnabled } from './entitlement.service'
import { snapshotMetricsStock } from './metrics.service'
import { runRetentionSweep, type RetentionSweepResult } from './retention.service'
import { redactOrphanedLedgerProviderIds } from './billingEventRedaction'
import { runRevenueRecognitionSweep, type RevenueRecognitionSweepResult } from './revenueRecognition.service'

export interface BillingSweepResult {
    skipped: boolean
    trialsExpired: number
    dunning: DunningSweepResult
    retention: RetentionSweepResult
    ledgerRedacted: number
    revenueRecognition: RevenueRecognitionSweepResult
}

/**
 * The scheduled pass: expire lapsed trials, send the dunning emails that are due, run the
 * retention window, then scrub provider ids from ledger events no account owns. Retention goes
 * before the scrub so a trial that expires in this run is stamped in the same run; the scrub is
 * data hygiene and runs whether or not billing is on. The metrics stock snapshot (M7b.2) and the
 * M8e revenue-recognition sweep are always attempted, on purpose or off - the former is just a
 * reading of whatever is in the database right now, and the latter no-ops itself behind its own
 * `FINANCE_OPS_ENABLED` flag (M8e is deliberately independent of `BILLING_ENABLED`).
 */
export const runBillingSweeps = async (now: Date = new Date()): Promise<BillingSweepResult> => {
    if (!isBillingEnabled()) {
        const result: BillingSweepResult = {
            skipped: true,
            trialsExpired: 0,
            dunning: { skipped: true, sent: 0, failed: 0 },
            retention: await runRetentionSweep(now),
            ledgerRedacted: await redactOrphanedLedgerProviderIds(now),
            revenueRecognition: await runRevenueRecognitionSweep(),
        }
        await snapshotMetricsStock(now)
        return result
    }

    const { expired } = await expireLapsedTrials(now)
    const dunning = await sendDunningEmails(now)
    const retention = await runRetentionSweep(now)
    const ledgerRedacted = await redactOrphanedLedgerProviderIds(now)
    const revenueRecognition = await runRevenueRecognitionSweep()
    await snapshotMetricsStock(now)

    return { skipped: false, trialsExpired: expired, dunning, retention, ledgerRedacted, revenueRecognition }
}
