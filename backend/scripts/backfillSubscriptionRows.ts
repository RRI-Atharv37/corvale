import dotenv from 'dotenv'

dotenv.config()

import { GRANDFATHER_KINDS, type GrandfatherKind } from '@core/billing/constants'
import connectDB from '@infra/db/db'
import { backfillSubscriptionRows } from '@migrations/subscriptionRowBackfill'

const parseGrandfatherKind = (): GrandfatherKind | null => {
    const flag = process.argv.find((arg) => arg.startsWith('--grandfather='))
    if (!flag) return null

    const kind = flag.slice('--grandfather='.length)
    if (!(GRANDFATHER_KINDS as readonly string[]).includes(kind)) {
        console.error(`--grandfather must be one of: ${GRANDFATHER_KINDS.join(', ')}`)
        process.exit(1)
    }
    return kind as GrandfatherKind
}

const main = async (): Promise<void> => {
    const dryRun = process.argv.includes('--dry-run')
    const grandfatherKind = parseGrandfatherKind()

    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set')
        process.exit(1)
    }

    await connectDB()

    console.log(
        `Creating subscription rows for users without one${dryRun ? ' (dry run)' : ''}` +
            (grandfatherKind ? `, grandfathered as ${grandfatherKind}...` : ', as 30-day trials...')
    )

    const result = await backfillSubscriptionRows({ dryRun, grandfatherKind })

    console.log('Backfill complete:')
    console.log(JSON.stringify(result, null, 2))

    process.exit(0)
}

main().catch((error) => {
    console.error('Backfill failed:', error)
    process.exit(1)
})
