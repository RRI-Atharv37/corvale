import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { createAuthRoutes } from './routes/authRoutes'
import incomeRoutes from './routes/incomeRoutes'
import expenseRoutes from './routes/expenseRoutes'
import saverRoutes from './routes/saverRoutes'
import pushoverRoutes from './routes/pushoverRoutes'
import accountRoutes from './routes/accountRoutes'
import categoryRoutes from './routes/categoryRoutes'
import transactionRoutes from './routes/transactionRoutes'
import receiptRoutes from './routes/receiptRoutes'
import budgetRoutes from './routes/budgetRoutes'
import savingsGoalRoutes from './routes/savingsGoalRoutes'
import recurringRuleRoutes from './routes/recurringRuleRoutes'
import dashboardRoutes from './routes/dashboardRoutes'
import reportRoutes from './routes/reportRoutes'
import { errorHandler } from './middleware/errorMiddleware'

export const createApp = (): express.Application => {
    const app = express()

    app.use(
        cors({
            origin: process.env.CLIENT_URL,
            methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
            allowedHeaders: ['Content-type', 'Authorization'],
            credentials: true,
        })
    )

    app.use(express.json())
    app.use(cookieParser())

    app.use('/api/v1/auth', createAuthRoutes())
    app.use('/api/v1/income', incomeRoutes)
    app.use('/api/v1/expense', expenseRoutes)
    app.use('/api/v1/saver', saverRoutes)
    app.use('/api/v1/pushover', pushoverRoutes)
    app.use('/api/v1/accounts', accountRoutes)
    app.use('/api/v1/categories', categoryRoutes)
    app.use('/api/v1/transactions', transactionRoutes)
    app.use('/api/v1/receipts', receiptRoutes)
    app.use('/api/v1/budgets', budgetRoutes)
    app.use('/api/v1/savings-goals', savingsGoalRoutes)
    app.use('/api/v1/recurring-rules', recurringRuleRoutes)
    app.use('/api/v1/dashboard', dashboardRoutes)
    app.use('/api/v1/dashboard/reports', reportRoutes)
    app.use(errorHandler)

    return app
}

const app = createApp()
export default app
