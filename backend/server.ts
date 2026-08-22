import dotenv from 'dotenv'
dotenv.config()

import app from './app'
import connectDB from './config/db'
import { ensureMasterCategoriesSeeded } from './utils/categorySeed'
import { registerGracefulShutdown } from './utils/gracefulShutdown'

connectDB().then(() => ensureMasterCategoriesSeeded())

const PORT = process.env.PORT || 5000
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`))

registerGracefulShutdown(server)
