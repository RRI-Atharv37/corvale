import dotenv from 'dotenv'

dotenv.config()

import connectDB from '@infra/db/db'
import { seedDemoAccount } from '@modules/demo'

const main = async (): Promise<void> => {
    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set')
        process.exit(1)
    }

    await connectDB()
    const result = await seedDemoAccount()
    console.log(JSON.stringify(result, null, 2))
    process.exit(0)
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
})
