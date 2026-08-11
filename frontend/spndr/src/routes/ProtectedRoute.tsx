import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useUser } from '../hooks/useUser'
import LoadingState from '../components/ui/LoadingState'

interface ProtectedRouteProps {
    children: React.ReactNode
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
    const { isAuthenticated, isInitializing } = useUser()
    const location = useLocation()
    const token = localStorage.getItem('token')

    if (isInitializing) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <LoadingState message="Restoring session..." />
            </div>
        )
    }

    if (!token || !isAuthenticated) {
        return <Navigate to="/login" replace state={{ from: location.pathname }} />
    }

    return <>{children}</>
}

export default ProtectedRoute
