import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useUser } from '../hooks/useUser'
import LoadingState from '../components/ui/LoadingState'

interface ProtectedRouteProps {
    children: React.ReactNode
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
    const { user, isAuthenticated, isInitializing } = useUser()
    const location = useLocation()
    const token = localStorage.getItem('token')

    if (isInitializing) {
        return (
            <div className="min-h-screen bg-base flex items-center justify-center">
                <LoadingState message="Restoring session..." />
            </div>
        )
    }

    if (!token || !isAuthenticated) {
        return <Navigate to="/" replace state={{ from: location.pathname }} />
    }

    if (user && user.isEmailVerified === false) {
        return <Navigate to="/verify-email" replace />
    }

    return <>{children}</>
}

export default ProtectedRoute
