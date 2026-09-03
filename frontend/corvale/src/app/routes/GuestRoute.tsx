import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useUser } from '../providers/useUser'
import LoadingState from '@ui/LoadingState'

interface GuestRouteProps {
    children: React.ReactNode
}

/** Wraps guest-only routes (`/login`, `/signup`) and bounces an already-authenticated visitor
 * onward. Honors `location.state.from` (set by `ProtectedRoute`'s redirect) rather than
 * hardcoding `/dashboard`, because this redirect can win the race against Login's own
 * `navigate(from)` call - both fire off the same `updateUser` state change - so it must agree
 * with Login on the destination (X2/BUG-04). */
const GuestRoute: React.FC<GuestRouteProps> = ({ children }) => {
    const { isAuthenticated, isInitializing } = useUser()
    const location = useLocation()

    if (isInitializing) {
        return (
            <div className="min-h-screen bg-page flex items-center justify-center">
                <LoadingState message="Loading..." />
            </div>
        )
    }

    if (isAuthenticated) {
        const from = (location.state as { from?: string } | null)?.from
        return <Navigate to={from || '/dashboard'} replace />
    }

    return <>{children}</>
}

export default GuestRoute
