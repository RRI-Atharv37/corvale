import { RLS_BYPASS } from '@core/access/rowLevelSecurity'
import {
    lifecycleStageIndex,
    resolveTrialLifecycleStage,
    resolveWinBackDue,
    type LifecycleEmailStage,
} from '@core/billing/lifecycleEmail'
import { deriveLapsedAt } from '@core/billing/retention'
import { isSmtpConfigured, sendLifecycleEmail } from '@infra/mail/mailService'
import { logger } from '@infra/observability/logger'
import { User } from '@modules/users'
import { buildUnsubscribeUrl } from '@modules/users/emailPreferences.service'

import { isBillingEnabled } from './entitlement.service'
import Subscription, { type ISubscription } from './subscription.model'

const BYPASS = { [RLS_BYPASS]: true }

const DAY_MS = 24 * 60 * 60 * 1000

export interface LifecycleSweepResult {
    skipped: boolean
    sent: number
    failed: number
    optedOut: number
}

const clientUrl = (): string => process.env.CLIENT_URL ?? 'http://localhost:5173'

type SubscriptionRow = Pick<ISubscription, 'status' | 'createdAt' | 'trialEndsAt' | 'currentPeriodEnd' | 'lapsedAt'>

const resolveDueStage = (row: SubscriptionRow, now: Date): LifecycleEmailStage | null => {
    if (row.status === 'trialing') {
        return row.trialEndsAt ? resolveTrialLifecycleStage(row.createdAt, row.trialEndsAt, now) : null
    }

    const lapsedAt = row.lapsedAt ?? deriveLapsedAt(row, now)
    if (resolveWinBackDue(lapsedAt, now)) return 'win_back'
    return row.status === 'trial_expired' ? 'trial_expired' : null
}

/**
 * One email per lifecycle stage, once each: the trial emails (day 0 / 7 / 21 / 2 days left / expiry) are
 * account notices, the win-back is marketing and honours `emailPreferences.marketing`. Same contract as
 * dunning - a stage is recorded only after the send succeeds, and after downtime only the latest due
 * stage goes out. An opted-out user's win-back is recorded without a send so it is not re-checked daily.
 * Addresses that were never verified are skipped: they may not belong to the person who typed them.
 */
export const sendLifecycleEmails = async (now: Date = new Date()): Promise<LifecycleSweepResult> => {
    if (!isBillingEnabled()) return { skipped: true, sent: 0, failed: 0, optedOut: 0 }

    if (!isSmtpConfigured()) {
        logger.warn('Lifecycle emails not sent: SMTP is not configured')
        return { skipped: false, sent: 0, failed: 0, optedOut: 0 }
    }

    const rows = await Subscription.find({
        status: { $in: ['trialing', 'trial_expired', 'cancelled'] },
        lifecycleEmailStage: { $ne: 'win_back' },
        grandfatherKind: { $ne: 'free_forever' },
        // A comped customer or an account held out of retention (an erasure hold, the demo account) is not chased.
        $nor: [{ retentionHoldUntil: { $gt: now } }, { 'adminGrant.kind': 'comp', 'adminGrant.until': { $gt: now } }],
    })
        .setOptions(BYPASS)
        .lean()

    const result: LifecycleSweepResult = { skipped: false, sent: 0, failed: 0, optedOut: 0 }

    for (const row of rows) {
        const stage = resolveDueStage(row, now)
        if (stage === null || lifecycleStageIndex(stage) <= lifecycleStageIndex(row.lifecycleEmailStage ?? null)) continue

        const user = await User.findById(row.userId).select('email isEmailVerified emailPreferences').lean()
        if (!user || !user.isEmailVerified) continue

        const record = () =>
            Subscription.updateOne(
                { _id: row._id, lifecycleEmailStage: row.lifecycleEmailStage ?? null },
                { $set: { lifecycleEmailStage: stage } }
            ).setOptions(BYPASS)

        if (stage === 'win_back' && user.emailPreferences?.marketing === false) {
            await record()
            result.optedOut += 1
            continue
        }

        try {
            await sendLifecycleEmail(user.email, {
                stage,
                trialEndsAt: row.trialEndsAt ?? null,
                daysLeft: row.trialEndsAt ? Math.max(0, Math.ceil((row.trialEndsAt.getTime() - now.getTime()) / DAY_MS)) : 0,
                appUrl: clientUrl(),
                billingUrl: `${clientUrl()}/settings/billing`,
                unsubscribeUrl: stage === 'win_back' ? buildUnsubscribeUrl(row.userId.toString()) : undefined,
            })
        } catch (error) {
            result.failed += 1
            logger.error('Lifecycle email failed', { stage, message: error instanceof Error ? error.message : 'unknown' })
            continue
        }

        await record()
        result.sent += 1
    }

    return result
}
