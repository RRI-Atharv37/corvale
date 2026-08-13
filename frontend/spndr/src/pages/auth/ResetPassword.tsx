import React, { useState } from 'react'
import AuthLayout from '../../components/layouts/AuthLayout'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Input from '../../components/inputs/Input'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import type { ApiResponse } from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import toast from 'react-hot-toast'

interface PasswordResetConfirmResponse {
    message: string
}

const ResetPassword = () => {
    const [searchParams] = useSearchParams()
    const token = searchParams.get('token') ?? ''
    const navigate = useNavigate()

    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()

        if (!token) {
            setError('Reset link is invalid or missing. Request a new one.')
            return
        }

        if (password.length < 8) {
            setError('Password must be at least 8 characters')
            return
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match')
            return
        }

        setError(null)
        setIsSubmitting(true)

        try {
            const response = await axiosInstance.post<ApiResponse<PasswordResetConfirmResponse>>(
                API_PATHS.AUTH.PASSWORD_RESET_CONFIRM,
                { token, password }
            )
            const data = unwrapApiData(response)
            toast.success(data.message)
            navigate('/login', { replace: true })
        } catch (err) {
            const message = getApiErrorMessage(err, 'Unable to reset password. The link may have expired.')
            setError(message)
            toast.error(message)
        } finally {
            setIsSubmitting(false)
        }
    }

    if (!token) {
        return (
            <AuthLayout>
                <div>
                    <h3 className="text-xl font-semibold text-fg">Invalid reset link</h3>
                    <p className="text-sm text-fg-muted mt-2 mb-4">
                        This password reset link is missing or invalid.
                    </p>
                    <Link className="text-sm font-medium text-accent hover:text-accent" to="/forgot-password">
                        Request a new link
                    </Link>
                </div>
            </AuthLayout>
        )
    }

    return (
        <AuthLayout>
            <div>
                <h3 className="text-xl font-semibold text-fg">Reset password</h3>
                <p className="text-xs text-fg-muted mt-1 mb-6">Choose a new password for your account.</p>

                <form onSubmit={handleSubmit}>
                    <Input
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        label="New password"
                        placeholder="Minimum 8 characters"
                        type="password"
                        disabled={isSubmitting}
                    />

                    <Input
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        label="Confirm password"
                        placeholder="Re-enter your password"
                        type="password"
                        disabled={isSubmitting}
                    />

                    {error && <p className="text-expense text-xs pb-2.5">{error}</p>}

                    <button type="submit" className="btn-primary" disabled={isSubmitting}>
                        {isSubmitting ? 'Resetting...' : 'Reset password'}
                    </button>

                    <p className="text-[13px] text-fg-muted mt-3">
                        <Link className="font-medium text-accent hover:text-accent" to="/login">
                            Back to sign in
                        </Link>
                    </p>
                </form>
            </div>
        </AuthLayout>
    )
}

export default ResetPassword
