import type { Express } from 'express'

import accountRoutes from '@modules/accounts/account.routes'
import { createAuthRoutes } from '@modules/auth/auth.routes'
import { createUserRoutes } from '@modules/users/user.routes'
import backupRoutes from '@modules/backup/backup.routes'
import budgetRoutes from '@modules/budgets/budget.routes'
import calendarRoutes from '@modules/calendar/calendar.routes'
import categoryRoutes from '@modules/categories/category.routes'
import categorizationRuleRoutes from '@modules/categorization-rules/categorizationRule.routes'
import dashboardRoutes from '@modules/dashboard/dashboard.routes'
import debtRoutes from '@modules/debts/debt.routes'
import desktopRoutes from '@modules/desktop/desktop.routes'
import exchangeRateRoutes from '@modules/exchange-rates/exchangeRate.routes'
import forecastRoutes from '@modules/forecast/forecast.routes'
import importRoutes from '@modules/import/import.routes'
import expenseRoutes from '@modules/legacy/expense.routes'
import incomeRoutes from '@modules/legacy/income.routes'
import notificationRoutes from '@modules/notifications/notification.routes'
import onboardingRoutes from '@modules/onboarding/onboarding.routes'
import receiptRoutes from '@modules/receipts/receipt.routes'
import reconciliationRoutes from '@modules/reconciliation/reconciliation.routes'
import recurringRuleRoutes from '@modules/recurring/recurringRule.routes'
import reportRoutes from '@modules/reports/report.routes'
import pushoverRoutes from '@modules/savers/pushover.routes'
import saverRoutes from '@modules/savers/saver.routes'
import savingsGoalRoutes from '@modules/savings-goals/savingsGoal.routes'
import subscriptionRoutes from '@modules/subscriptions/subscription.routes'
import { createSyncRoutes } from '@modules/sync/sync.routes'
import tagRoutes from '@modules/tags/tag.routes'
import transactionRoutes from '@modules/transactions/transaction.routes'
import transactionTemplateRoutes from '@modules/transaction-templates/transactionTemplate.routes'
import { createWorkspaceRoutes } from '@modules/workspaces/workspace.routes'

/**
 * The single mount table over `modules/*`. Route strings are unchanged from the pre-RF3
 * `app.ts` — this refactor moves no URL. Middleware wiring stays in `app.ts`.
 *
 * Routers are imported by deep path (`@modules/x/x.routes`) rather than through each module's
 * `index.ts`: a route file imports `@http/middleware`, `authMiddleware` imports the users model,
 * so routing a router through a module barrel would drag the whole barrel — and its load-time
 * `createXRoutes()` — into a cycle. The mount table is the one place allowed to know route paths.
 */
export const mountRoutes = (app: Express): void => {
    app.use('/api/v1/auth', createAuthRoutes())
    // User-account routes (`/user`, `/legal/accept`, `/account/*`) live in the users module but
    // stack onto the same `/api/v1/auth` base — RF3 moved no URL.
    app.use('/api/v1/auth', createUserRoutes())
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
    app.use('/api/v1/desktop', desktopRoutes)
    app.use('/api/v1/sync', createSyncRoutes())
}
