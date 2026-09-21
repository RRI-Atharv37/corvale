import { expireLapsedTrials } from './trial.service'
import { sendDunningEmails, type DunningSweepResult } from './dunning.service'
import { isBillingEnabled } from './entitlement.service'
import { runRetentionSweep, type RetentionSweepResult } from './retention.service'

export interface BillingSweepResult {
    skipped: boolean
    trialsExpired: number
    dunning: DunningSweepResult
    retention: RetentionSweepResult
}

/**
 * The scheduled pass: expire lapsed trials, send the dunning emails that are due, then run the
 * retention window. Retention goes last so a trial that expires in this run is stamped in the same run.
 */
export const runBillingSweeps = async (now: Date = new Date()): Promise<BillingSweepResult> => {
    if (!isBillingEnabled()) {
        return {
            skipped: true,
            trialsExpired: 0,
            dunning: { skipped: true, sent: 0, failed: 0 },
            retention: await runRetentionSweep(now),
        }
    }

    const { expired } = await expireLapsedTrials(now)
    const dunning = await sendDunningEmails(now)
    const retention = await runRetentionSweep(now)

    return { skipped: false, trialsExpired: expired, dunning, retention }
}
