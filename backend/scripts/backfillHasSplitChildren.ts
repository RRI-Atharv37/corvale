import dotenv from 'dotenv'

dotenv.config()

import connectDB from '@infra/db/db'
import { backfillHasSplitChildren } from '@migrations/hasSplitChildrenBackfill'

const main = async (): Promise<void> => {
    const dryRun = process.argv.includes('--dry-run')

    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set')
        process.exit(1)
    }

    await connectDB()

    console.log(dryRun ? 'Running hasSplitChildren backfill (dry run)...' : 'Running hasSplitChildren backfill...')

    const result = await backfillHasSplitChildren({ dryRun })

    console.log('Backfill complete:')
    console.log(JSON.stringify(result, null, 2))

    process.exit(0)
}

main().catch((error) => {
    console.error('Backfill failed:', error)
    process.exit(1)
})
