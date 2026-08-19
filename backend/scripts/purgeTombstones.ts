import dotenv from 'dotenv'

dotenv.config()

import connectDB from '../config/db'
import { purgeExpiredTombstones, TOMBSTONE_RETENTION_DAYS } from '../utils/purgeTombstones'

const main = async (): Promise<void> => {
    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set')
        process.exit(1)
    }

    const retentionArg = process.argv.find((arg) => arg.startsWith('--retention-days='))
    const retentionDays = retentionArg
        ? Number(retentionArg.split('=')[1])
        : TOMBSTONE_RETENTION_DAYS

    await connectDB()

    console.log(`Purging tombstones older than ${retentionDays} days...`)

    const results = await purgeExpiredTombstones(retentionDays)

    console.log('Purge complete:')
    console.log(JSON.stringify(results, null, 2))

    process.exit(0)
}

main().catch((error) => {
    console.error('Tombstone purge failed:', error)
    process.exit(1)
})
