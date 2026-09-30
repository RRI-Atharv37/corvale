import dotenv from 'dotenv'

dotenv.config()

import connectDB from '@infra/db/db'
import { backfillTransferRoles } from '@migrations/transferRoleBackfill'

const main = async (): Promise<void> => {
    const dryRun = process.argv.includes('--dry-run')

    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set')
        process.exit(1)
    }

    await connectDB()

    console.log(dryRun ? 'Running transferRole backfill (dry run)...' : 'Running transferRole backfill...')

    const result = await backfillTransferRoles({ dryRun })

    console.log('Backfill complete:')
    console.log(JSON.stringify(result, null, 2))

    process.exit(0)
}

main().catch((error) => {
    console.error('Backfill failed:', error)
    process.exit(1)
})
