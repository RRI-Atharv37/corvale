import dotenv from 'dotenv'

dotenv.config()

import connectDB from '../config/db'
import { backfillEmailVerification } from '../utils/backfillEmailVerification'

const main = async (): Promise<void> => {
    const dryRun = process.argv.includes('--dry-run')

    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set')
        process.exit(1)
    }

    await connectDB()

    console.log(dryRun ? 'Running email-verification backfill (dry run)...' : 'Running email-verification backfill...')

    const result = await backfillEmailVerification({ dryRun })

    console.log('Backfill complete:')
    console.log(JSON.stringify(result, null, 2))

    process.exit(0)
}

main().catch((error) => {
    console.error('Backfill failed:', error)
    process.exit(1)
})
