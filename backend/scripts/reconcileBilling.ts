import dotenv from 'dotenv'

dotenv.config()

import connectDB from '@infra/db/db'
import { initErrorTracking } from '@infra/observability/errorTracking'
import { reconcileBillingSubscriptions, DEFAULT_IN_FLIGHT_WINDOW_MS, withJobRun } from '@modules/billing'

const EXIT_DRIFT = 2

const main = async (): Promise<void> => {
    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set')
        process.exit(1)
    }

    const windowArg = process.argv.find((arg) => arg.startsWith('--in-flight-minutes='))
    const windowRaw = windowArg ? windowArg.split('=')[1] : undefined
    const inFlightWindowMs = windowRaw !== undefined ? Number(windowRaw) * 60_000 : DEFAULT_IN_FLIGHT_WINDOW_MS

    if (!Number.isFinite(inFlightWindowMs) || inFlightWindowMs < 0) {
        console.error(`--in-flight-minutes must be zero or a positive number (got "${windowRaw}").`)
        process.exit(1)
    }

    initErrorTracking()
    await connectDB()

    const outcome = await withJobRun('reconcile:billing', async () => {
        const report = await reconcileBillingSubscriptions({ inFlightWindowMs })

        return {
            report,
            counts: { checked: report.checked, drift: report.drift.length, deferred: report.deferred },
            exitCode: report.drift.length > 0 ? EXIT_DRIFT : 0,
        }
    })

    if (outcome.report.skipped) {
        console.log('BILLING_ENABLED is not true; nothing to reconcile.')
        process.exit(0)
    }

    console.log(JSON.stringify(outcome.report, null, 2))
    process.exit(outcome.exitCode)
}

main().catch((error) => {
    console.error('Billing reconciliation failed:', error)
    process.exit(1)
})
