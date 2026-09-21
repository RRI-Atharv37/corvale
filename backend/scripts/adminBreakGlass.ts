import dotenv from 'dotenv'

dotenv.config()

import connectDB from '@infra/db/db'
import { breakGlass } from '@modules/admin'
import { promptHidden, readFlag } from './lib/hiddenPrompt'

const main = async (): Promise<void> => {
    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set')
        process.exit(1)
    }

    const email = readFlag('email')
    if (!email) {
        console.error('Usage: npm run admin:break-glass -- --email admin@example.com [--confirm-last-owner]')
        process.exit(1)
    }

    const secret = await promptHidden('Break-glass secret (input hidden): ')
    await connectDB()

    const result = await breakGlass({ email, secret, confirmLastOwner: process.argv.includes('--confirm-last-owner') })
    const origin = process.env.ADMIN_ORIGIN ?? '<your admin origin>'

    console.log('\nThat admin can no longer sign in: sessions ended, authenticator and recovery codes cleared.')
    console.log(`Give them this link (works once, 15 minutes). They must confirm their existing password:\n  ${origin}/enrol#token=${result.enrolmentToken}`)
    console.log(`\nSecurity notices sent: ${result.notified}. Sensitive admin actions stay blocked for 24 hours after they re-enrol.`)
    process.exit(0)
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
})
