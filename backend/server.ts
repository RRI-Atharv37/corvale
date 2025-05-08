import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import cors from 'cors'
import connectDB from './config/db'
import authRoutes from './routes/authRoutes'
import incomeRoutes from './routes/incomeRoutes'
import expenseRoutes from './routes/expenseRoutes'
import { errorHandler } from './middleware/errorMiddleware'

const app = express()

app.use(
    cors({
        origin: process.env.CLIENT_URL || "*",
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-type', 'Authorization']
    })
)

app.use(express.json())

connectDB()

app.use('/api/v1/auth', authRoutes)
app.use('/api/v1/income', incomeRoutes)
app.use('/api/v1/expense', expenseRoutes)
app.use(errorHandler)

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err)
    process.exit(1)
})

// app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
//     const statusCode = res.statusCode === 200 ? 500 : res.statusCode
//     res.status(statusCode).json({
//         message: err.message,
//         stack: process.env.NODE_ENV === 'production' ? null : err.stack,
//     })
// })

const PORT = process.env.PORT || 5000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
