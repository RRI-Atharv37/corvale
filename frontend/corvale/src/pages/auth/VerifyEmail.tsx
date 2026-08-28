import React, { useEffect, useState } from 'react'
import AuthLayout from '../../components/layouts/AuthLayout'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import type { ApiResponse } from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import toast from 'react-hot-toast'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import OfflineNotice from '../../components/ui/OfflineNotice'
import { useUser } from '../../hooks/useUser'

interface EmailVerificationResponse {
    message: string
}

type Status = 'confirming' | 'confirmed' | 'failed' | 'awaiting'

const VerifyEmail = () => {
    const [searchParams] = useSearchParams()
    const token = searchParams.get('token') ?? ''
    const navigate = useNavigate()
    const location = useLocation()
    const online = useOnlineStatus()
    const { isAuthenticated, restoreSession, logout } = useUser()

    // Set when Login bounces a hard-blocked unverified account here: there's no session, so
    // resend goes out by email instead.
    const emailFromState = (location.state as { email?: string } | null)?.email ?? ''
    const canResend = isAuthenticated || Boolean(emailFromState)

    const [status, setStatus] = useState<Status>(token ? 'confirming' : 'awaiting')
    const [error, setError] = useState<string | null>(null)
    const [isResending, setIsResending] = useState(false)

    useEffect(() => {
        if (!token) {
            return
        }

        let cancelled = false

        const confirm = async () => {
            try {
                const response = await axiosInstance.post<ApiResponse<EmailVerificationResponse>>(
                    API_PATHS.AUTH.EMAIL_VERIFICATION_CONFIRM,
                    { token }
                )
                unwrapApiData(response)
                if (cancelled) return

                setStatus('confirmed')
                toast.success('Email verified')

                if (isAuthenticated) {
                    await restoreSession()
                    navigate('/dashboard', { replace: true })
                } else {
                    navigate('/login', { replace: true })
                }
            } catch (err) {
                if (cancelled) return
                setStatus('failed')
                setError(getApiErrorMessage(err, 'This verification link is invalid or has expired.'))
            }
        }

        void confirm()

        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token])

    const handleBackToSignIn = async () => {
        if (isAuthenticated) {
            await logout()
        }
        navigate('/login', { replace: true })
    }

    const handleResend = async () => {
        setIsResending(true)
        try {
            // Signed in: the server resolves the account from the token. Signed out (bounced from
            // login): pass the email so the server can look it up, enumeration-safe.
            const response = isAuthenticated
                ? await axiosInstance.post<ApiResponse<EmailVerificationResponse>>(
                      API_PATHS.AUTH.EMAIL_VERIFICATION_RESEND
                  )
                : await axiosInstance.post<ApiResponse<EmailVerificationResponse>>(
                      API_PATHS.AUTH.EMAIL_VERIFICATION_RESEND,
                      { email: emailFromState }
                  )
            const data = unwrapApiData(response)
            toast.success(data.message)
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Unable to resend verification email.'))
        } finally {
            setIsResending(false)
        }
    }

    if (status === 'confirming') {
        return (
            <AuthLayout>
                <div>
                    <h3 className="text-xl font-semibold text-fg">Verifying your email...</h3>
                </div>
            </AuthLayout>
        )
    }

    if (status === 'confirmed') {
        return (
            <AuthLayout>
                <div>
                    <h3 className="text-xl font-semibold text-fg">Email verified</h3>
                    <p className="text-sm text-fg-muted mt-2">Redirecting...</p>
                </div>
            </AuthLayout>
        )
    }

    if (status === 'failed') {
        return (
            <AuthLayout>
                <div>
                    <h3 className="text-xl font-semibold text-fg">Verification failed</h3>
                    <p className="text-sm text-fg-muted mt-2 mb-4">{error}</p>
                    {canResend ? (
                        <button
                            type="button"
                            className="btn-primary"
                            onClick={handleResend}
                            disabled={isResending || !online}
                        >
                            {isResending ? 'Sending...' : 'Resend verification email'}
                        </button>
                    ) : (
                        <Link className="text-sm font-medium text-accent hover:text-accent" to="/login">
                            Back to sign in
                        </Link>
                    )}
                </div>
            </AuthLayout>
        )
    }

    return (
        <AuthLayout>
            <div>
                <h3 className="text-xl font-semibold text-fg">Verify your email</h3>
                <p className="text-sm text-fg-muted mt-2 mb-4">
                    {emailFromState
                        ? `Verify your email address to sign in. We sent a link to ${emailFromState} — click it to continue.`
                        : 'We sent a verification link to your email address. Click it to finish setting up your account.'}
                </p>

                {!online && <OfflineNotice message="You are offline. Resending requires a connection." />}

                {canResend && (
                    <button
                        type="button"
                        className="btn-primary"
                        onClick={handleResend}
                        disabled={isResending || !online}
                    >
                        {isResending ? 'Sending...' : 'Resend verification email'}
                    </button>
                )}

                <p className="text-[13px] text-fg-muted mt-3">
                    {isAuthenticated ? (
                        <button
                            type="button"
                            className="font-medium text-accent hover:text-accent"
                            onClick={handleBackToSignIn}
                        >
                            Back to sign in
                        </button>
                    ) : (
                        <Link className="font-medium text-accent hover:text-accent" to="/login">
                            Back to sign in
                        </Link>
                    )}
                </p>
            </div>
        </AuthLayout>
    )
}

export default VerifyEmail
