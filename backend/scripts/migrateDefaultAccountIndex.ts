import dotenv from 'dotenv'

dotenv.config()

import connectDB from '@infra/db/db'
import { migrateDefaultAccountIndex } from '@migrations/defaultAccountIndex'

const main = async (): Promise<void> => {
    const dryRun = process.argv.includes('--dry-run')

    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set')
        process.exit(1)
    }

    await connectDB()

    console.log(dryRun ? 'Checking the default-account index (dry run)...' : 'Migrating the default-account index...')

    const result = await migrateDefaultAccountIndex({ dryRun })

    console.log('Migration complete:')
    console.log(JSON.stringify(result, null, 2))

    process.exit(0)
}

main().catch((error) => {
    console.error('Migration failed:', error)
    process.exit(1)
})
