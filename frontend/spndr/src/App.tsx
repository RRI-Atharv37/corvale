import React from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'

import Login from './pages/auth/Login'
import Signup from './pages/auth/Signup'
import ForgotPassword from './pages/auth/ForgotPassword'
import ResetPassword from './pages/auth/ResetPassword'
import Home from './pages/Dashboard/Home'
import Transactions from './pages/Dashboard/Transactions'
import Saver from './pages/Dashboard/Saver'
import Pushover from './pages/Dashboard/Pushover'
import Accounts from './pages/Dashboard/Accounts'
import Categories from './pages/Dashboard/Categories'
import CategorizationRules from './pages/Dashboard/CategorizationRules'
import Tags from './pages/Dashboard/Tags'
import Budgets from './pages/Dashboard/Budgets'
import SavingsGoals from './pages/Dashboard/SavingsGoals'
import Recurring from './pages/Dashboard/Recurring'
import Reports from './pages/Dashboard/Reports'
import Workspaces from './pages/Dashboard/Workspaces'
import UserProvider from './context/UserContext'
import WorkspaceProvider from './context/WorkspaceContext'
import ProtectedRoute from './routes/ProtectedRoute'
import DashboardLayout from './components/layouts/DashboardLayout'
import { useUser } from './hooks/useUser'
import LoadingState from './components/ui/LoadingState'
import Landing from './pages/Landing'

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
                        <WorkspaceProvider>
                            <DashboardLayout />
                        </WorkspaceProvider>
                    </ProtectedRoute>
                }
            >
                <Route path="/dashboard" element={<Home />} />
                <Route path="/transactions" element={<Transactions />} />
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
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    )
}

const App = () => {
    return (
        <UserProvider>
            <Router>
                <AppRoutes />
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
