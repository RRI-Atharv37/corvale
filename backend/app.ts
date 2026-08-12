import express from 'express'
import cors from 'cors'
import { createAuthRoutes } from './routes/authRoutes'
import incomeRoutes from './routes/incomeRoutes'
import expenseRoutes from './routes/expenseRoutes'
import saverRoutes from './routes/saverRoutes'
import pushoverRoutes from './routes/pushoverRoutes'
import accountRoutes from './routes/accountRoutes'
import { errorHandler } from './middleware/errorMiddleware'

export const createApp = (): express.Application => {
    const app = express()

    app.use(
        cors({
            origin: process.env.CLIENT_URL,
            methods: ['GET', 'POST', 'PUT', 'DELETE'],
            allowedHeaders: ['Content-type', 'Authorization'],
            credentials: true,
        })
    )

    app.use(express.json())

    app.use('/api/v1/auth', createAuthRoutes())
    app.use('/api/v1/income', incomeRoutes)
    app.use('/api/v1/expense', expenseRoutes)
    app.use('/api/v1/saver', saverRoutes)
    app.use('/api/v1/pushover', pushoverRoutes)
    app.use('/api/v1/accounts', accountRoutes)
    app.use(errorHandler)

    return app
}

const app = createApp()
export default app
