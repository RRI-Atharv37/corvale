import dotenv from 'dotenv'

dotenv.config()

import connectDB from '@infra/db/db'
import { revokeAllSessions } from '@modules/auth/sessionRevocation.service'

const main = async (): Promise<void> => {
    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set')
        process.exit(1)
    }

    const dryRun = process.argv.includes('--dry-run')

    await connectDB()

    const result = await revokeAllSessions({ dryRun })

    console.log(dryRun ? '[dry run] Would end every session (nothing changed):' : 'Every session ended:')
    console.log(JSON.stringify(result, null, 2))

    process.exit(0)
}

main().catch((error) => {
    console.error('Session revocation failed:', error)
    process.exit(1)
})
