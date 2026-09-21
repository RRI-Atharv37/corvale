import { RLS_BYPASS } from '@core/access/rowLevelSecurity'
import { dunningStageIndex, resolveDunningStage } from '@core/billing/dunning'
import { isSmtpConfigured, sendDunningEmail } from '@infra/mail/mailService'
import { logger } from '@infra/observability/logger'
import { User } from '@modules/users'

import { getPastDueGraceDays, isBillingEnabled } from './entitlement.service'
import Subscription from './subscription.model'

const BYPASS = { [RLS_BYPASS]: true }

const DAY_MS = 24 * 60 * 60 * 1000

export interface DunningSweepResult {
    skipped: boolean
    sent: number
    failed: number
}

const billingUrl = (): string => `${process.env.CLIENT_URL ?? 'http://localhost:5173'}/settings/billing`

/**
 * One email per escalation stage, once each. A stage is recorded only after the send succeeds, so a
 * failed send is retried by the next run; after downtime only the latest due stage is sent. Whether
 * writes are still allowed is derived by the resolver from the same grace window, not by this sweep.
 */
export const sendDunningEmails = async (now: Date = new Date()): Promise<DunningSweepResult> => {
    if (!isBillingEnabled()) return { skipped: true, sent: 0, failed: 0 }

    if (!isSmtpConfigured()) {
        logger.warn('Dunning emails not sent: SMTP is not configured')
        return { skipped: false, sent: 0, failed: 0 }
    }

    const graceDays = getPastDueGraceDays()
    const rows = await Subscription.find({
        status: 'past_due',
        pastDueSince: { $ne: null },
        grandfatherKind: { $ne: 'free_forever' },
        // A customer comped by staff is not chased for a payment; an override or a hold does not stop it.
        $nor: [{ 'adminGrant.kind': 'comp', 'adminGrant.until': { $gt: now } }],
    })
        .setOptions(BYPASS)
        .lean()

    let sent = 0
    let failed = 0

    for (const row of rows) {
        if (!row.pastDueSince) continue

        const stage = resolveDunningStage(row.pastDueSince, now, graceDays)
        if (stage === null || dunningStageIndex(stage) <= dunningStageIndex(row.dunningStage ?? null)) continue

        const user = await User.findById(row.userId).select('email').lean()
        if (!user) continue

        try {
            await sendDunningEmail(user.email, {
                stage,
                graceEndsAt: new Date(row.pastDueSince.getTime() + graceDays * DAY_MS),
                billingUrl: billingUrl(),
            })
        } catch (error) {
            failed += 1
            logger.error('Dunning email failed', { stage, message: error instanceof Error ? error.message : 'unknown' })
            continue
        }

        await Subscription.updateOne(
            { _id: row._id, status: 'past_due', dunningStage: row.dunningStage ?? null },
            { $set: { dunningStage: stage } }
        ).setOptions(BYPASS)
        sent += 1
    }

    return { skipped: false, sent, failed }
}
