import React from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'

import Login from './pages/auth/Login'
import Signup from './pages/auth/Signup'
import Home from './pages/Dashboard/Home'
import Transactions from './pages/Dashboard/Transactions'
import Saver from './pages/Dashboard/Saver'
import Pushover from './pages/Dashboard/Pushover'
import Accounts from './pages/Dashboard/Accounts'
import Categories from './pages/Dashboard/Categories'
import UserProvider from './context/UserContext'
import ProtectedRoute from './routes/ProtectedRoute'
import DashboardLayout from './components/layouts/DashboardLayout'
import { useUser } from './hooks/useUser'
import LoadingState from './components/ui/LoadingState'

const AppRoutes = () => {
    return (
        <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
            <Route path="/signup" element={<GuestRoute><Signup /></GuestRoute>} />

            <Route
                element={
                    <ProtectedRoute>
                        <DashboardLayout />
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
                            background: '#1e293b',
                            color: '#e2e8f0',
                            border: '1px solid #334155',
                        },
                        success: {
                            iconTheme: { primary: '#22d3ee', secondary: '#0f172a' },
                        },
                        error: {
                            iconTheme: { primary: '#f87171', secondary: '#0f172a' },
                        },
                    }}
                />
            </Router>
        </UserProvider>
    )
}

const RootRedirect = () => {
    const { isAuthenticated, isInitializing } = useUser()

    if (isInitializing) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <LoadingState message="Loading..." />
            </div>
        )
    }

    return <Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />
}

interface GuestRouteProps {
    children: React.ReactNode
}

const GuestRoute: React.FC<GuestRouteProps> = ({ children }) => {
    const { isAuthenticated, isInitializing } = useUser()

    if (isInitializing) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
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
