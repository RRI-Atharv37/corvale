import type { Types } from 'mongoose'

import { LAPSED_STATUSES, isRetentionPaused, retentionClockStart, retentionEndsAt } from '@core/billing/retention'
import { getPastDueGraceDays, getRetentionDays, isBillingEnabled, isRetentionEnabled, type IJobRun, type JobName } from '@modules/billing'

import {
    countRows,
    countUnprocessedEvents,
    findLatestJobRun,
    findRecentUnprocessedEvents,
    findRows,
    type SubscriptionRow,
} from './adminData.service'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const GRACE_WARNING_WINDOW_MS = 48 * HOUR_MS
const ERASURE_LOOKAHEAD_DAYS = 14
const LIST_LIMIT = 50
const RECENT_EVENT_LIMIT = 10

/** The sweep is meant to run hourly; reconciliation daily. Past these ages "last run" is reported as stale. */
const STALE_AFTER_MS: Record<JobName, number> = {
    'sweep:billing': 2 * HOUR_MS,
    'reconcile:billing': 26 * HOUR_MS,
}

const describeJob = (name: JobName, run: IJobRun | null, now: Date) => ({
    lastRun: run
        ? { startedAt: run.startedAt, finishedAt: run.finishedAt, ok: run.ok, exitCode: run.exitCode, counts: run.counts ?? {}, error: run.error }
        : null,
    stale: !run || now.getTime() - run.startedAt.getTime() > STALE_AFTER_MS[name],
})

const idOf = (value: Types.ObjectId): string => value.toString()

const pastDueNearGraceEnd = async (now: Date) => {
    const graceMs = getPastDueGraceDays() * DAY_MS
    const filter = {
        status: 'past_due',
        grandfatherKind: { $ne: 'free_forever' },
        $nor: [{ 'adminGrant.kind': 'comp', 'adminGrant.until': { $gt: now } }],
        pastDueSince: { $gt: new Date(now.getTime() - graceMs), $lte: new Date(now.getTime() - graceMs + GRACE_WARNING_WINDOW_MS) },
    }

    const [count, rows] = await Promise.all([countRows(filter), findRows(filter, LIST_LIMIT)])
    return {
        hours: GRACE_WARNING_WINDOW_MS / HOUR_MS,
        count,
        items: rows
            .filter((row) => row.pastDueSince)
            .map((row) => ({ userId: idOf(row.userId), graceEndsAt: new Date((row.pastDueSince as Date).getTime() + graceMs) })),
    }
}

const eraseOn = (row: SubscriptionRow, retentionDays: number, now: Date): Date | null => {
    if (!row.lapsedAt) return null
    const compUntil = row.adminGrant?.kind === 'comp' ? row.adminGrant.until : null
    if (isRetentionPaused(row.retentionHoldUntil, compUntil, now)) return null

    return retentionEndsAt(retentionClockStart(row.lapsedAt, row.retentionHoldUntil, compUntil), retentionDays)
}

const upcomingErasures = async (now: Date) => {
    const retentionEnabled = isRetentionEnabled()
    if (!retentionEnabled) return { days: ERASURE_LOOKAHEAD_DAYS, retentionEnabled, count: 0, items: [] }

    const retentionDays = getRetentionDays()
    const horizon = new Date(now.getTime() + ERASURE_LOOKAHEAD_DAYS * DAY_MS)
    const candidates = await findRows(
        {
            status: { $in: [...LAPSED_STATUSES] },
            lapsedAt: { $ne: null, $lte: new Date(horizon.getTime() - retentionDays * DAY_MS) },
            grandfatherKind: { $ne: 'free_forever' },
        },
        1000
    )

    const due = candidates
        .map((row) => ({ userId: idOf(row.userId), eraseOn: eraseOn(row, retentionDays, now) }))
        .filter((item): item is { userId: string; eraseOn: Date } => item.eraseOn !== null && item.eraseOn.getTime() <= horizon.getTime())
        .sort((a, b) => a.eraseOn.getTime() - b.eraseOn.getTime())

    return { days: ERASURE_LOOKAHEAD_DAYS, retentionEnabled, count: due.length, items: due.slice(0, LIST_LIMIT) }
}

/**
 * What needs an operator's attention today, as counts and ids only: nothing here names a person. The job
 * panel exists because nothing schedules the sweeps yet, so a silent stop has to be visible.
 */
export const getOpsHealth = async (now: Date = new Date()) => {
    const [unprocessedCount, recentUnprocessed, nearGrace, erasures, sweep, reconcile] = await Promise.all([
        countUnprocessedEvents(),
        findRecentUnprocessedEvents(RECENT_EVENT_LIMIT),
        pastDueNearGraceEnd(now),
        upcomingErasures(now),
        findLatestJobRun('sweep:billing'),
        findLatestJobRun('reconcile:billing'),
    ])

    return {
        billingEnabled: isBillingEnabled(),
        retentionEnabled: isRetentionEnabled(),
        unprocessedEvents: {
            count: unprocessedCount,
            recent: recentUnprocessed.map((event) => ({
                type: event.type,
                occurredAt: event.occurredAt,
                error: event.error ? event.error.slice(0, 300) : null,
            })),
        },
        pastDueNearGraceEnd: nearGrace,
        upcomingErasures: erasures,
        jobs: {
            'sweep:billing': describeJob('sweep:billing', sweep, now),
            'reconcile:billing': describeJob('reconcile:billing', reconcile, now),
        },
    }
}
