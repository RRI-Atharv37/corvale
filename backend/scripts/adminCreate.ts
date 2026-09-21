import dotenv from 'dotenv'

dotenv.config()

import connectDB from '@infra/db/db'
import { createBootstrapOwner } from '@modules/admin'
import { promptHidden, readFlag } from './lib/hiddenPrompt'

const main = async (): Promise<void> => {
    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set')
        process.exit(1)
    }

    const email = readFlag('email')
    if (!email) {
        console.error('Usage: npm run admin:create -- --email owner@example.com')
        process.exit(1)
    }

    const secret = await promptHidden('Bootstrap secret (input hidden): ')
    await connectDB()

    const grant = await createBootstrapOwner({ email, secret })
    const origin = process.env.ADMIN_ORIGIN ?? '<your admin origin>'

    console.log('\nFirst owner created in a pending state. Nothing can sign in until enrolment is finished.')
    console.log(`Open this link within 15 minutes and set a password and authenticator:\n  ${origin}/enrol#token=${grant.enrolmentToken}`)
    console.log('\nThe link works once. Remove ADMIN_BOOTSTRAP_SECRET_SHA256 from the environment now; bootstrap will not run again.')
    process.exit(0)
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
})
