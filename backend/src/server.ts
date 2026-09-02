import dotenv from 'dotenv'
dotenv.config()

import app from '../app'
import connectDB from '@infra/db/db'
import { ensureMasterCategoriesSeeded } from '../utils/categorySeed'
import { registerGracefulShutdown } from '@infra/config/gracefulShutdown'
import { initErrorTracking } from '@infra/observability/errorTracking'

initErrorTracking()

connectDB().then(() => ensureMasterCategoriesSeeded())

const PORT = process.env.PORT || 5000
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`))

registerGracefulShutdown(server)
