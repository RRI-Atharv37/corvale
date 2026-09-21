import { RLS_BYPASS } from '@core/access/rowLevelSecurity'
import {
    DEFAULT_RETENTION_DAYS,
    FINAL_WARNING_LEAD_DAYS,
    LAPSED_STATUSES,
    MAX_RETENTION_DAYS,
    MIN_RETENTION_DAYS,
    deriveLapsedAt,
    isDeletionDue,
    resolveRetentionStage,
    retentionEndsAt,
    retentionStageIndex,
} from '@core/billing/retention'
import { CustomError } from '@core/errors/customError'
import { isSmtpConfigured, sendRetentionEmail } from '@infra/mail/mailService'
import { logger } from '@infra/observability/logger'
import { User } from '@modules/users'
// Account deletion imports the billing index back; both sides only use each other inside functions, never at load.
import { assertAccountDeletionAllowed, deleteUserAccountCascade } from '@modules/users/accountDeletionUtils'

import { isBillingEnabled } from './entitlement.service'
import Subscription from './subscription.model'

const BYPASS = { [RLS_BYPASS]: true }
const NO_TIMESTAMPS = { timestamps: false }
const LAPSED = [...LAPSED_STATUSES]

const DAY_MS = 24 * 60 * 60 * 1000

export interface RetentionSweepResult {
    skipped: boolean
    stamped: number
    cleared: number
    notified: number
    failed: number
    deleted: number
    blocked: number
}

const EMPTY_RESULT: RetentionSweepResult = { skipped: false, stamped: 0, cleared: 0, notified: 0, failed: 0, deleted: 0, blocked: 0 }

/** Erasing lapsed accounts is opt-in: the window has to be stated in the Terms before it is enforced. */
export const isRetentionEnabled = (): boolean => process.env.BILLING_RETENTION_ENABLED === 'true'

export const getRetentionDays = (): number => {
    const configured = Number(process.env.BILLING_RETENTION_DAYS)
    return Number.isInteger(configured) && configured >= MIN_RETENTION_DAYS && configured <= MAX_RETENTION_DAYS
        ? configured
        : DEFAULT_RETENTION_DAYS
}

const billingUrl = (): string => `${process.env.CLIENT_URL ?? 'http://localhost:5173'}/settings/billing`

/**
 * Keeps `lapsedAt` true to `status` whoever changed the status (a webhook, the trial sweep, an admin),
 * so the retention clock never depends on a handler remembering to stamp it. Bookkeeping only: it runs
 * whether or not deletion is enabled and never touches user data.
 */
const syncLapsedAt = async (now: Date): Promise<{ stamped: number; cleared: number }> => {
    const unstamped = await Subscription.find({ status: { $in: LAPSED }, lapsedAt: null }).setOptions(BYPASS).lean()

    let stamped = 0
    for (const row of unstamped) {
        const result = await Subscription.updateOne(
            { _id: row._id, status: { $in: LAPSED }, lapsedAt: null },
            { $set: { lapsedAt: deriveLapsedAt(row, now), retentionStage: null, retentionStageAt: null } },
            NO_TIMESTAMPS
        ).setOptions(BYPASS)
        stamped += result.modifiedCount
    }

    const reactivated = await Subscription.updateMany(
        {
            status: { $nin: LAPSED },
            $or: [{ lapsedAt: { $ne: null } }, { retentionStage: { $ne: null } }, { retentionStageAt: { $ne: null } }],
        },
        { $set: { lapsedAt: null, retentionStage: null, retentionStageAt: null } },
        NO_TIMESTAMPS
    ).setOptions(BYPASS)

    return { stamped, cleared: reactivated.modifiedCount }
}

type EraseOutcome = 'deleted' | 'blocked' | 'skipped' | 'failed'

/** The last look before something irreversible: the row must still be lapsed, with the same warning on record. */
const eraseIfStillLapsed = async (rowId: unknown, userId: string, lapsedAt: Date): Promise<EraseOutcome> => {
    const fresh = await Subscription.findOne({
        _id: rowId,
        status: { $in: LAPSED },
        lapsedAt,
        retentionStage: 'final_warning',
        grandfatherKind: { $ne: 'free_forever' },
    })
        .setOptions(BYPASS)
        .lean()
    if (!fresh) return 'skipped'

    try {
        await assertAccountDeletionAllowed(userId)
        await deleteUserAccountCascade(userId)
        return 'deleted'
    } catch (error) {
        if (error instanceof CustomError && error.statusCode === 409) return 'blocked'
        logger.error('Retention erasure failed', { message: error instanceof Error ? error.message : 'unknown' })
        return 'failed'
    }
}

/**
 * The retention window for lapsed accounts (`cancelled` / `trial_expired`): notices at the start, 30
 * days out and 7 days out, then erasure exactly as a user-initiated deletion would erase it. Inside the
 * window nothing is touched, and a reactivation restores everything because nothing was ever removed.
 * Erasure needs the window to have ended AND a delivered final warning at least 7 days old.
 */
export const runRetentionSweep = async (now: Date = new Date()): Promise<RetentionSweepResult> => {
    if (!isBillingEnabled()) return { ...EMPTY_RESULT, skipped: true }

    const result: RetentionSweepResult = { ...EMPTY_RESULT, ...(await syncLapsedAt(now)) }
    if (!isRetentionEnabled()) return result

    if (!isSmtpConfigured()) {
        logger.warn('Retention sweep did nothing: SMTP is not configured, so no notice could be delivered')
        return result
    }

    const retentionDays = getRetentionDays()
    const rows = await Subscription.find({
        status: { $in: LAPSED },
        lapsedAt: { $ne: null },
        grandfatherKind: { $ne: 'free_forever' },
    })
        .setOptions(BYPASS)
        .lean()

    for (const row of rows) {
        if (!row.lapsedAt) continue

        const user = await User.findById(row.userId).select('email').lean()
        if (!user) continue

        const stageAt = row.retentionStageAt ?? null
        if (isDeletionDue({ lapsedAt: row.lapsedAt, now, retentionDays, stage: row.retentionStage ?? null, stageAt })) {
            const outcome = await eraseIfStillLapsed(row._id, row.userId.toString(), row.lapsedAt)
            if (outcome === 'deleted') result.deleted += 1
            else if (outcome === 'blocked') result.blocked += 1
            else if (outcome === 'failed') result.failed += 1
            continue
        }

        const stage = resolveRetentionStage(row.lapsedAt, now, retentionDays)
        if (stage === null || retentionStageIndex(stage) <= retentionStageIndex(row.retentionStage ?? null)) continue

        const windowEnds = retentionEndsAt(row.lapsedAt, retentionDays)
        const earliestWarnedDeletion = new Date(now.getTime() + FINAL_WARNING_LEAD_DAYS * DAY_MS)
        const deletionDate = stage === 'final_warning' && earliestWarnedDeletion > windowEnds ? earliestWarnedDeletion : windowEnds

        try {
            await sendRetentionEmail(user.email, { stage, deletionDate, billingUrl: billingUrl() })
        } catch (error) {
            result.failed += 1
            logger.error('Retention email failed', { stage, message: error instanceof Error ? error.message : 'unknown' })
            continue
        }

        await Subscription.updateOne(
            {
                _id: row._id,
                status: { $in: LAPSED },
                lapsedAt: row.lapsedAt,
                retentionStage: row.retentionStage ?? null,
            },
            { $set: { retentionStage: stage, retentionStageAt: now } },
            NO_TIMESTAMPS
        ).setOptions(BYPASS)
        result.notified += 1
    }

    if (result.deleted > 0 || result.blocked > 0) {
        logger.info('Retention sweep erased lapsed accounts', { deleted: result.deleted, blocked: result.blocked })
    }
    return result
}
