import dotenv from 'dotenv'

dotenv.config()

import connectDB from '@infra/db/db'
import { initErrorTracking } from '@infra/observability/errorTracking'
import { recomputeAllUsageCounters, runBillingSweeps } from '@modules/billing'

const EXIT_DELIVERY_FAILURES = 2

const main = async (): Promise<void> => {
    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set')
        process.exit(1)
    }

    initErrorTracking()
    await connectDB()

    const sweep = await runBillingSweeps()
    if (sweep.skipped) {
        console.log(`BILLING_ENABLED is not true; only the ledger scrub ran (${sweep.ledgerRedacted} redacted).`)
        process.exit(0)
    }

    const report: Record<string, unknown> = { ...sweep }
    if (process.argv.includes('--recompute-usage')) {
        report.usageRecomputed = await recomputeAllUsageCounters()
    }

    console.log(JSON.stringify(report, null, 2))
    process.exit(sweep.dunning.failed > 0 || sweep.retention.failed > 0 ? EXIT_DELIVERY_FAILURES : 0)
}

main().catch((error) => {
    console.error('Billing sweep failed:', error)
    process.exit(1)
})
