import React, { useState } from 'react'
import AuthLayout from '../../components/layouts/AuthLayout'
import { Link } from 'react-router-dom'
import Input from '../../components/Inputs/Input'
import { validateEmail } from '../../utils/helper'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import type { ApiResponse } from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import toast from 'react-hot-toast'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import OfflineNotice from '../../components/ui/OfflineNotice'

interface PasswordResetRequestResponse {
    message: string
}

const ForgotPassword = () => {
    const [email, setEmail] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [submitted, setSubmitted] = useState(false)
    const online = useOnlineStatus()

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()

        if (!validateEmail(email)) {
            setError('Please enter a valid email address')
            return
        }

        setError(null)
        setIsSubmitting(true)

        try {
            const response = await axiosInstance.post<ApiResponse<PasswordResetRequestResponse>>(
                API_PATHS.AUTH.PASSWORD_RESET_REQUEST,
                { email }
            )
            const data = unwrapApiData(response)
            setSubmitted(true)
            toast.success(data.message)
        } catch (err) {
            const message = getApiErrorMessage(err, 'Unable to process request. Please try again.')
            setError(message)
            toast.error(message)
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <AuthLayout>
            <div>
                <h3 className="text-xl font-semibold text-fg">Forgot password</h3>
                <p className="text-xs text-fg-muted mt-1 mb-6">
                    Enter your email and we&apos;ll send a reset link if an account exists.
                </p>

                {submitted ? (
                    <div className="space-y-4">
                        <p className="text-sm text-fg-secondary">
                            If an account exists for that email, a password reset link has been sent. Check your
                            inbox or server logs in development.
                        </p>
                        <Link
                            className="inline-block text-sm font-medium text-accent hover:text-accent"
                            to="/login"
                        >
                            Back to sign in
                        </Link>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        <Input
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            label="Email address"
                            placeholder="you@example.com"
                            type="email"
                            disabled={isSubmitting}
                        />

                        {error && <p className="text-expense text-xs pb-2.5">{error}</p>}
                        {!online && <OfflineNotice />}

                        <button type="submit" className="btn-primary" disabled={isSubmitting || !online}>
                            {isSubmitting ? 'Sending...' : 'Send reset link'}
                        </button>

                        <p className="text-[13px] text-fg-muted mt-3">
                            Remember your password?{' '}
                            <Link className="font-medium text-accent hover:text-accent" to="/login">
                                Sign in
                            </Link>
                        </p>
                    </form>
                )}
            </div>
        </AuthLayout>
    )
}

export default ForgotPassword
