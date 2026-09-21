import dotenv from 'dotenv'

dotenv.config()

import connectDB from '@infra/db/db'
import { initErrorTracking } from '@infra/observability/errorTracking'
import { runAdminSweeps } from '@modules/admin'
import { recomputeAllUsageCounters, runBillingSweeps, withJobRun } from '@modules/billing'

const EXIT_DELIVERY_FAILURES = 2

const main = async (): Promise<void> => {
    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set')
        process.exit(1)
    }

    initErrorTracking()
    await connectDB()

    const outcome = await withJobRun('sweep:billing', async () => {
        const sweep = await runBillingSweeps()
        const admin = await runAdminSweeps()

        const report: Record<string, unknown> = { ...sweep, admin }
        if (!sweep.skipped && process.argv.includes('--recompute-usage')) {
            report.usageRecomputed = await recomputeAllUsageCounters()
        }

        return {
            report,
            sweep,
            counts: {
                trialsExpired: sweep.trialsExpired,
                dunningSent: sweep.dunning.sent,
                dunningFailed: sweep.dunning.failed,
                retentionNotified: sweep.retention.notified,
                retentionDeleted: sweep.retention.deleted,
                retentionFailed: sweep.retention.failed,
                ledgerRedacted: sweep.ledgerRedacted,
                auditIpsScrubbed: admin.auditIpsScrubbed,
            },
            exitCode: sweep.dunning.failed > 0 || sweep.retention.failed > 0 ? EXIT_DELIVERY_FAILURES : 0,
        }
    })

    if (outcome.sweep.skipped) {
        console.log(`BILLING_ENABLED is not true; only the ledger scrub ran (${outcome.sweep.ledgerRedacted} redacted).`)
        process.exit(0)
    }

    console.log(JSON.stringify(outcome.report, null, 2))
    process.exit(outcome.exitCode)
}

main().catch((error) => {
    console.error('Billing sweep failed:', error)
    process.exit(1)
})
