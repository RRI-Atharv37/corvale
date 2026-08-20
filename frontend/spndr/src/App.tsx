import React, { lazy } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'

import Login from './pages/auth/Login'
import Signup from './pages/auth/Signup'
import ForgotPassword from './pages/auth/ForgotPassword'
import ResetPassword from './pages/auth/ResetPassword'
import UserProvider from './context/UserContext'
import WorkspaceProvider from './context/WorkspaceContext'
import ProtectedRoute from './routes/ProtectedRoute'
import DashboardLayout from './components/layouts/DashboardLayout'
import { useUser } from './hooks/useUser'
import LoadingState from './components/ui/LoadingState'
import Landing from './pages/Landing'
import PinGate from './offline/PinGate'
import UpdatePrompt from './pwa/UpdatePrompt'
import OfflineBanner from './pwa/OfflineBanner'
import DesktopUpdatePrompt from './desktop/DesktopUpdatePrompt'
import { isTauriRuntime } from './desktop/isTauri'

// Sprint 13.8: dashboard pages are route-level code-split (previously all 25 were static
// imports, so every visitor downloaded the entire dashboard - including Reports/recharts and
// every planning page - just to see the login screen or landing page).
const Home = lazy(() => import('./pages/Dashboard/Home'))
const Transactions = lazy(() => import('./pages/Dashboard/Transactions'))
const ImportTransactions = lazy(() => import('./pages/Dashboard/ImportTransactions'))
const Saver = lazy(() => import('./pages/Dashboard/Saver'))
const Pushover = lazy(() => import('./pages/Dashboard/Pushover'))
const Accounts = lazy(() => import('./pages/Dashboard/Accounts'))
const Categories = lazy(() => import('./pages/Dashboard/Categories'))
const CategorizationRules = lazy(() => import('./pages/Dashboard/CategorizationRules'))
const Tags = lazy(() => import('./pages/Dashboard/Tags'))
const Budgets = lazy(() => import('./pages/Dashboard/Budgets'))
const SavingsGoals = lazy(() => import('./pages/Dashboard/SavingsGoals'))
const Recurring = lazy(() => import('./pages/Dashboard/Recurring'))
const Reports = lazy(() => import('./pages/Dashboard/Reports'))
const Workspaces = lazy(() => import('./pages/Dashboard/Workspaces'))
const Forecast = lazy(() => import('./pages/Dashboard/Forecast'))
const CalendarPage = lazy(() => import('./pages/Dashboard/CalendarPage'))
const Subscriptions = lazy(() => import('./pages/Dashboard/Subscriptions'))
const DebtPayoff = lazy(() => import('./pages/Dashboard/DebtPayoff'))

const AppRoutes = () => {
    return (
        <Routes>
            <Route path="/" element={<HomeRoute />} />
            <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
            <Route path="/signup" element={<GuestRoute><Signup /></GuestRoute>} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            <Route
                element={
                    <ProtectedRoute>
                        <PinGate>
                            <WorkspaceProvider>
                                <DashboardLayout />
                            </WorkspaceProvider>
                        </PinGate>
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

interface GuestRouteProps {
    children: React.ReactNode
}

const GuestRoute: React.FC<GuestRouteProps> = ({ children }) => {
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

    return <>{children}</>
}

export default App
