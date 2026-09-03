import React, { lazy, Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'

import Login from '@features/auth/LoginPage'
import Signup from '@features/auth/SignupPage'
import ForgotPassword from '@features/auth/ForgotPasswordPage'
import ResetPassword from '@features/auth/ResetPasswordPage'
import VerifyEmail from '@features/auth/VerifyEmailPage'
import UserProvider from './providers/UserContext'
import WorkspaceProvider from './providers/WorkspaceContext'
import ProtectedRoute from './routes/ProtectedRoute'
import GuestRoute from './routes/GuestRoute'
import DashboardLayout from './layouts/DashboardLayout'
import { useUser } from './providers/useUser'
import LoadingState from '@ui/LoadingState'
import Landing from '@features/landing/LandingPage'
import PinGate from '@platform/offline/PinGate'
import LocalDbRecoveryGate from './LocalDbRecoveryGate'
import LegalGate from '@features/legal/components/LegalGate'
import UpdatePrompt from '@platform/pwa/UpdatePrompt'
import OfflineBanner from '@platform/pwa/OfflineBanner'
import DesktopUpdatePrompt from '@platform/desktop/DesktopUpdatePrompt'
import { isTauriRuntime } from '@lib/isTauri'
import { LEGAL_DOCUMENTS } from '@/legal'

// Sprint 13.8: dashboard pages are route-level code-split (previously all 25 were static
// imports, so every visitor downloaded the entire dashboard - including Reports/recharts and
// every planning page - just to see the login screen or landing page).
const Home = lazy(() => import('@features/dashboard/HomePage'))
const Transactions = lazy(() => import('@features/transactions/TransactionsPage'))
const ImportTransactions = lazy(() => import('@features/import/ImportTransactionsPage'))
const Saver = lazy(() => import('@features/saver/SaverPage'))
const Pushover = lazy(() => import('@features/saver/PushoverPage'))
const Accounts = lazy(() => import('@features/accounts/AccountsPage'))
const Categories = lazy(() => import('@features/categories/CategoriesPage'))
const CategorizationRules = lazy(() => import('@features/categories/CategorizationRulesPage'))
const Tags = lazy(() => import('@features/tags/TagsPage'))
const Budgets = lazy(() => import('@features/budgets/BudgetsPage'))
const SavingsGoals = lazy(() => import('@features/savings-goals/SavingsGoalsPage'))
const Recurring = lazy(() => import('@features/recurring/RecurringPage'))
const Reports = lazy(() => import('@features/reports/ReportsPage'))
const Workspaces = lazy(() => import('@features/workspaces/WorkspacesPage'))
const Forecast = lazy(() => import('@features/forecast/ForecastPage'))
const CalendarPage = lazy(() => import('@features/calendar/CalendarPage'))
const Subscriptions = lazy(() => import('@features/subscriptions/SubscriptionsPage'))
const DebtPayoff = lazy(() => import('@features/debts/DebtPayoffPage'))
const Download = lazy(() => import('@features/download/DownloadPage'))
const LegalPage = lazy(() => import('@features/legal/LegalPage'))

const AppRoutes = () => {
    return (
        <Routes>
            <Route path="/" element={<HomeRoute />} />
            <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
            <Route path="/signup" element={<GuestRoute><Signup /></GuestRoute>} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route
                path="/download"
                element={
                    <Suspense fallback={<LoadingState message="Loading..." />}>
                        <Download />
                    </Suspense>
                }
            />

            <Route
                element={
                    <ProtectedRoute>
                        <LocalDbRecoveryGate>
                            <PinGate>
                                <LegalGate>
                                    <WorkspaceProvider>
                                        <DashboardLayout />
                                    </WorkspaceProvider>
                                </LegalGate>
                            </PinGate>
                        </LocalDbRecoveryGate>
                    </ProtectedRoute>
                }
            >
                <Route path="/dashboard" element={<Home />} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/transactions/import" element={<ImportTransactions />} />
                <Route path="/income" element={<Navigate to="/transactions?type=income" replace />} />
                <Route path="/expense" element={<Navigate to="/transactions?type=expense" replace />} />
                <Route path="/saver" element={<Saver />} />
                <Route path="/pushover" element={<Pushover />} />
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/categories" element={<Categories />} />
                <Route path="/categories/rules" element={<CategorizationRules />} />
                <Route path="/tags" element={<Tags />} />
                <Route path="/budgets" element={<Budgets />} />
                <Route path="/savings-goals" element={<SavingsGoals />} />
                <Route path="/recurring" element={<Recurring />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/workspaces" element={<Workspaces />} />
                <Route path="/forecast" element={<Forecast />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/subscriptions" element={<Subscriptions />} />
                <Route path="/debts" element={<DebtPayoff />} />
            </Route>

            {/* Public legal pages (M0c). Generated from the document registry so a route can
                never go missing when a document is added, and declared before the catch-all
                below - which would otherwise redirect them all to "/". */}
            {LEGAL_DOCUMENTS.map((doc) => (
                <Route
                    key={doc.slug}
                    path={doc.path}
                    element={
                        <Suspense fallback={<LoadingState message="Loading..." />}>
                            <LegalPage document={doc} />
                        </Suspense>
                    }
                />
            ))}

            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    )
}

const App = () => {
    return (
        <UserProvider>
            <Router>
                <OfflineBanner />
                <AppRoutes />
                {isTauriRuntime() ? <DesktopUpdatePrompt /> : <UpdatePrompt />}
                <Toaster
                    position="top-right"
                    toastOptions={{
                        className: 'text-sm',
                        style: {
                            background: '#2e2a40',
                            color: '#f8f6ff',
                            border: '1px solid #3d3654',
                        },
                        success: {
                            iconTheme: { primary: '#a855f7', secondary: '#14121c' },
                        },
                        error: {
                            iconTheme: { primary: '#fb7185', secondary: '#14121c' },
                        },
                    }}
                />
            </Router>
        </UserProvider>
    )
}

const HomeRoute = () => {
    const { isAuthenticated, isInitializing } = useUser()

    if (isInitializing) {
        return (
            <div className="min-h-screen bg-page flex items-center justify-center">
                <LoadingState message="Loading..." />
            </div>
        )
    }

    if (isAuthenticated) {
        return <Navigate to="/dashboard" replace />
    }

    return <Landing />
}

export default App
