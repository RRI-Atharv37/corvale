import React, { useState } from 'react'
import { AxiosError } from 'axios'
import AuthLayout from '../../components/layouts/AuthLayout'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Input from '../../components/Inputs/Input'
import { validateEmail } from '../../utils/helper'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { parseAuthPayload, setAuthSession } from '../../context/UserContext'
import { useUser } from '../../hooks/useUser'
import type { ApiResponse, AuthPayload } from '../../types/api'
import { getApiErrorMessage } from '../../utils/apiError'
import toast from 'react-hot-toast'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import OfflineNotice from '../../components/ui/OfflineNotice'

const Login = () => {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const navigate = useNavigate()
    const location = useLocation()
    const { updateUser } = useUser()
    const online = useOnlineStatus()
    const from = (location.state as { from?: string } | null)?.from

    const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()

        if (!validateEmail(email)) {
            setError('Please enter a valid email address')
            return
        }

        if (!password) {
            setError('Please enter a password.')
            return
        }

        setError('')
        setIsSubmitting(true)

        try {
            const response = await axiosInstance.post<ApiResponse<AuthPayload>>(API_PATHS.AUTH.LOGIN, {
                email,
                password,
            })

            const payload = parseAuthPayload(response)
            await setAuthSession(payload)
            updateUser(payload.user)
            toast.success('Welcome back!')
            navigate(from || '/dashboard')
        } catch (err) {
            // An unverified account is hard-blocked at login (403). Send them to the verify
            // screen with their email so they can request a fresh link without a session.
            if (err instanceof AxiosError && err.response?.status === 403) {
                navigate('/verify-email', { state: { email } })
                return
            }
            const message = getApiErrorMessage(err, 'An error occurred. Please try again.')
            setError(message)
            toast.error(message)
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <AuthLayout>
            <div>
                <h3 className="text-xl font-semibold text-fg">Welcome back</h3>
                <p className="text-xs text-fg-muted mt-1 mb-6">Sign in to your account</p>

                <form onSubmit={handleLogin}>
                    <Input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        label="Email address"
                        placeholder="you@example.com"
                        type="email"
                        disabled={isSubmitting}
                    />

                    <Input
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        label="Password"
                        placeholder="Enter your password"
                        type="password"
                        disabled={isSubmitting}
                    />

                    {error && <p className="text-expense text-xs pb-2.5">{error}</p>}
                    {!online && <OfflineNotice message="You are offline. Sign in requires a connection." />}

                    <div className="flex justify-end mb-3">
                        <Link
                            className="text-xs font-medium text-accent hover:text-accent"
                            to="/forgot-password"
                        >
                            Forgot password?
                        </Link>
                    </div>

                    <button type="submit" className="btn-primary" disabled={isSubmitting || !online}>
                        {isSubmitting ? 'Signing in...' : 'Sign in'}
                    </button>

                    <p className="text-[13px] text-fg-muted mt-3">
                        Don&apos;t have an account?{' '}
                        <Link className="font-medium text-accent hover:text-accent" to="/signup">
                            Sign up
                        </Link>
                    </p>
                </form>
            </div>
        </AuthLayout>
    )
}

export default Login
