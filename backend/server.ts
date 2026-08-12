import dotenv from 'dotenv'
dotenv.config()

import app from './app'
import connectDB from './config/db'

connectDB()

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err)
    process.exit(1)
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
