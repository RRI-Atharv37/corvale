import dotenv from 'dotenv'

dotenv.config()

import connectDB from '@infra/db/db'
import { migrateLegacyLedgerToTransactions } from "@modules/legacy/migrateLegacyTransactions";

const main = async (): Promise<void> => {
    const dryRun = process.argv.includes('--dry-run')

    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set')
        process.exit(1)
    }

    await connectDB()

    console.log(dryRun ? 'Running migration (dry run)...' : 'Running migration...')

    const result = await migrateLegacyLedgerToTransactions({ dryRun })

    console.log('Migration complete:')
    console.log(JSON.stringify(result, null, 2))

    process.exit(0)
}

main().catch((error) => {
    console.error('Migration failed:', error)
    process.exit(1)
})
