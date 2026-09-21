import { expireLapsedTrials } from './trial.service'
import { sendDunningEmails, type DunningSweepResult } from './dunning.service'
import { isBillingEnabled } from './entitlement.service'

export interface BillingSweepResult {
    skipped: boolean
    trialsExpired: number
    dunning: DunningSweepResult
}

/** The scheduled pass: expire lapsed trials, then send the dunning emails that are due. */
export const runBillingSweeps = async (now: Date = new Date()): Promise<BillingSweepResult> => {
    if (!isBillingEnabled()) {
        return { skipped: true, trialsExpired: 0, dunning: { skipped: true, sent: 0, failed: 0 } }
    }

    const { expired } = await expireLapsedTrials(now)
    const dunning = await sendDunningEmails(now)

    return { skipped: false, trialsExpired: expired, dunning }
}
