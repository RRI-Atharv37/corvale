import dotenv from 'dotenv'

dotenv.config()

import connectDB from '../config/db'
import { migrateAccountBalancesToMinorUnits } from '../utils/migrateAccountBalancesToMinorUnits'

const main = async (): Promise<void> => {
    const dryRun = process.argv.includes('--dry-run')

    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set')
        process.exit(1)
    }

    await connectDB()

    console.log(
        dryRun
            ? 'Running account-balance minor-units migration (dry run)...'
            : 'Running account-balance minor-units migration...'
    )
    console.log(
        'NOTE: do not run this against a deployment with active offline/desktop (VITE_LOCAL_FIRST) ' +
            'clients until the frontend local-first engine has been updated to match — see the ' +
            'docstring on migrateAccountBalancesToMinorUnits.ts.'
    )

    const result = await migrateAccountBalancesToMinorUnits({ dryRun })

    console.log('Migration complete:')
    console.log(JSON.stringify(result, null, 2))

    process.exit(0)
}

main().catch((error) => {
    console.error('Migration failed:', error)
    process.exit(1)
})
