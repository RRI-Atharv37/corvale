import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { validateEnv } from './utils/envValidation'
import { ERROR_MESSAGES } from './utils/errorMessages'
import healthRoutes from './routes/healthRoutes'
import { createAuthRoutes } from './routes/authRoutes'
import incomeRoutes from './routes/incomeRoutes'
import expenseRoutes from './routes/expenseRoutes'
import saverRoutes from './routes/saverRoutes'
import pushoverRoutes from './routes/pushoverRoutes'
import accountRoutes from './routes/accountRoutes'
import categoryRoutes from './routes/categoryRoutes'
import tagRoutes from './routes/tagRoutes'
import categorizationRuleRoutes from './routes/categorizationRuleRoutes'
import transactionTemplateRoutes from './routes/transactionTemplateRoutes'
import transactionRoutes from './routes/transactionRoutes'
import receiptRoutes from './routes/receiptRoutes'
import budgetRoutes from './routes/budgetRoutes'
import savingsGoalRoutes from './routes/savingsGoalRoutes'
import recurringRuleRoutes from './routes/recurringRuleRoutes'
import dashboardRoutes from './routes/dashboardRoutes'
import reportRoutes from './routes/reportRoutes'
import notificationRoutes from './routes/notificationRoutes'
import { createWorkspaceRoutes } from './routes/workspaceRoutes'
import importRoutes from './routes/importRoutes'
import backupRoutes from './routes/backupRoutes'
import forecastRoutes from './routes/forecastRoutes'
import calendarRoutes from './routes/calendarRoutes'
import subscriptionRoutes from './routes/subscriptionRoutes'
import debtRoutes from './routes/debtRoutes'
import reconciliationRoutes from './routes/reconciliationRoutes'
import exchangeRateRoutes from './routes/exchangeRateRoutes'
import onboardingRoutes from './routes/onboardingRoutes'
import { createSyncRoutes } from './routes/syncRoutes'
import { sanitizeBody } from './middleware/sanitizeBodyMiddleware'
import { buildCorsOriginAllowlist } from './utils/corsOriginAllowlist'
import { createGlobalRateLimiter } from './middleware/rateLimitMiddleware'
import { errorHandler } from './middleware/errorMiddleware'
import { requestLogger } from './middleware/requestLoggerMiddleware'

/**
 * TRUST_PROXY is unset (false) by default so req.ip is the socket's own address, matching
 * Express's default. Behind a reverse proxy, set it to the number of hops (e.g. "1") or a
 * trusted IP/CIDR list so the rate limiters key on the real client IP instead of the proxy's
 * (SEC-26) — see https://expressjs.com/en/guide/behind-proxies.html.
 */
const parseTrustProxy = (value: string | undefined): boolean | number | string => {
    if (value === undefined) return false
    if (value === 'true') return true
    if (value === 'false') return false
    const asNumber = Number(value)
    if (value.trim() !== '' && !Number.isNaN(asNumber)) return asNumber
    return value
}

export const createApp = (): express.Application => {
    validateEnv()

    const app = express()
    app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY))

    app.use(
        helmet({
            contentSecurityPolicy: {
                useDefaults: false,
                directives: {
                    defaultSrc: ["'none'"],
                    frameAncestors: ["'none'"],
                },
            },
            frameguard: { action: 'deny' },
            crossOriginResourcePolicy: { policy: 'same-origin' },
        })
    )

    const corsOriginAllowlist = buildCorsOriginAllowlist(process.env.CLIENT_URL as string)

    app.use(
        cors({
            origin: (origin, callback) => {
                if (!origin || corsOriginAllowlist.includes(origin)) {
                    callback(null, true)
                    return
                }
                callback(null, false)
            },
            methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
            allowedHeaders: ['Content-type', 'Authorization'],
            credentials: true,
        })
    )

    app.use(express.json({ limit: '1mb' }))
    app.use(cookieParser())
    app.use(sanitizeBody)
    app.use(requestLogger)

    app.use(healthRoutes)

    app.use('/api/v1', createGlobalRateLimiter())

    app.use('/api/v1/auth', createAuthRoutes())
    app.use('/api/v1/income', incomeRoutes)
    app.use('/api/v1/expense', expenseRoutes)
    app.use('/api/v1/saver', saverRoutes)
    app.use('/api/v1/pushover', pushoverRoutes)
    app.use('/api/v1/accounts', accountRoutes)
    app.use('/api/v1/categories', categoryRoutes)
    app.use('/api/v1/tags', tagRoutes)
    app.use('/api/v1/categorization-rules', categorizationRuleRoutes)
    app.use('/api/v1/transaction-templates', transactionTemplateRoutes)
    app.use('/api/v1/transactions', transactionRoutes)
    app.use('/api/v1/receipts', receiptRoutes)
    app.use('/api/v1/budgets', budgetRoutes)
    app.use('/api/v1/savings-goals', savingsGoalRoutes)
    app.use('/api/v1/recurring-rules', recurringRuleRoutes)
    app.use('/api/v1/dashboard', dashboardRoutes)
    app.use('/api/v1/dashboard/reports', reportRoutes)
    app.use('/api/v1/notifications', notificationRoutes)
    app.use('/api/v1/workspaces', createWorkspaceRoutes())
    app.use('/api/v1/imports', importRoutes)
    app.use('/api/v1/backup', backupRoutes)
    app.use('/api/v1/forecast', forecastRoutes)
    app.use('/api/v1/calendar', calendarRoutes)
    app.use('/api/v1/subscriptions', subscriptionRoutes)
    app.use('/api/v1/debts', debtRoutes)
    app.use('/api/v1/reconciliation-sessions', reconciliationRoutes)
    app.use('/api/v1/exchange-rates', exchangeRateRoutes)
    app.use('/api/v1/onboarding', onboardingRoutes)
    app.use('/api/v1/sync', createSyncRoutes())

    app.use((_req, res) => {
        res.status(404).json({
            success: false,
            statusCode: 404,
            message: ERROR_MESSAGES.GENERAL.ROUTE_NOT_FOUND,
        })
    })

    app.use(errorHandler)

    return app
}

const app = createApp()
export default app
