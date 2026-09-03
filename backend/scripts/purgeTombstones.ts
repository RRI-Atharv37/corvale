import dotenv from 'dotenv'

dotenv.config()

import connectDB from '@infra/db/db'
import { purgeExpiredTombstones, TOMBSTONE_RETENTION_DAYS } from '@migrations/tombstonePurge'

const main = async (): Promise<void> => {
    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set')
        process.exit(1)
    }

    const dryRun = process.argv.includes('--dry-run')

    const retentionArg = process.argv.find((arg) => arg.startsWith('--retention-days='))
    const retentionRaw = retentionArg ? retentionArg.split('=')[1] : undefined
    const retentionDays = retentionRaw !== undefined ? Number(retentionRaw) : TOMBSTONE_RETENTION_DAYS

    if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
        console.error(
            `--retention-days must be a positive number (got "${retentionRaw}"). ` +
                'Refusing to run: 0 or a negative value would purge every tombstone.'
        )
        process.exit(1)
    }

    await connectDB()

    console.log(
        dryRun
            ? `[dry run] Tombstones older than ${retentionDays} days that WOULD be purged:`
            : `Purging tombstones older than ${retentionDays} days...`
    )

    const results = await purgeExpiredTombstones(retentionDays, { dryRun })

    console.log(dryRun ? 'Dry run complete (nothing deleted):' : 'Purge complete:')
    console.log(JSON.stringify(results, null, 2))

    process.exit(0)
}

main().catch((error) => {
    console.error('Tombstone purge failed:', error)
    process.exit(1)
})
