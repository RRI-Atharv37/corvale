import { expireLapsedTrials } from './trial.service'
import { sendDunningEmails, type DunningSweepResult } from './dunning.service'
import { isBillingEnabled } from './entitlement.service'
import { runRetentionSweep, type RetentionSweepResult } from './retention.service'
import { redactOrphanedLedgerProviderIds } from './billingEventRedaction'

export interface BillingSweepResult {
    skipped: boolean
    trialsExpired: number
    dunning: DunningSweepResult
    retention: RetentionSweepResult
    ledgerRedacted: number
}

/**
 * The scheduled pass: expire lapsed trials, send the dunning emails that are due, run the
 * retention window, then scrub provider ids from ledger events no account owns. Retention goes
 * before the scrub so a trial that expires in this run is stamped in the same run; the scrub is
 * data hygiene and runs whether or not billing is on.
 */
export const runBillingSweeps = async (now: Date = new Date()): Promise<BillingSweepResult> => {
    if (!isBillingEnabled()) {
        return {
            skipped: true,
            trialsExpired: 0,
            dunning: { skipped: true, sent: 0, failed: 0 },
            retention: await runRetentionSweep(now),
            ledgerRedacted: await redactOrphanedLedgerProviderIds(now),
        }
    }

    const { expired } = await expireLapsedTrials(now)
    const dunning = await sendDunningEmails(now)
    const retention = await runRetentionSweep(now)
    const ledgerRedacted = await redactOrphanedLedgerProviderIds(now)

    return { skipped: false, trialsExpired: expired, dunning, retention, ledgerRedacted }
}
