import dotenv from 'dotenv'

dotenv.config()

import connectDB from '@infra/db/db'
import { replayErasures } from '@modules/users/erasureReplay.service'

const main = async (): Promise<void> => {
    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set')
        process.exit(1)
    }

    const dryRun = process.argv.includes('--dry-run')

    await connectDB()

    const result = await replayErasures({ dryRun })

    console.log(dryRun ? '[dry run] Accounts that WOULD be erased again (nothing deleted):' : 'Erasure replay complete:')
    console.log(JSON.stringify(result, null, 2))

    process.exit(0)
}

main().catch((error) => {
    console.error('Erasure replay failed:', error)
    process.exit(1)
})
