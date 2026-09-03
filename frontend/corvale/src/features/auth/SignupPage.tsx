import React, { useState } from 'react'
import AuthLayout from '@ui/layouts/AuthLayout'
import { Link, useNavigate } from 'react-router-dom'
import Input from '@ui/inputs/Input'
import { validateEmail } from '@lib/helper'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { parseAuthPayload, setAuthSession } from '@/app/providers/UserContext'
import { useUser } from '@/app/providers/useUser'
import type { ApiResponse } from '@lib/types/api'
import type { AuthPayload } from '@features/auth/types'
import { getApiErrorMessage } from '@lib/apiError'
import toast from 'react-hot-toast'
import { useOnlineStatus } from '@platform/offline/useOnlineStatus'
import OfflineNotice from '@ui/OfflineNotice'
import Captcha from './components/Captcha'
import { BRAND } from '@lib/brand'
import { detectTimezone } from '@platform/timezoneSync'

const captchaEnabled = import.meta.env.VITE_CAPTCHA_ENABLED === 'true'

const Signup = () => {
    const [fullName, setFullName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [captchaToken, setCaptchaToken] = useState('')
    const [ageAttested, setAgeAttested] = useState(false)
    const [error, setError] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const navigate = useNavigate()
    const { updateUser } = useUser()
    const online = useOnlineStatus()

    const handleSignup = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()

        if (!fullName) {
            setError('Please enter your full name.')
            return
        }

        if (!validateEmail(email)) {
            setError('Please enter a valid email address.')
            return
        }

        if (!password) {
            setError('Please enter a password')
            return
        }

        if (captchaEnabled && !captchaToken) {
            setError('Please complete the CAPTCHA.')
            return
        }

        if (!ageAttested) {
            setError('Please confirm that you are 18 or older.')
            return
        }

        setError('')
        setIsSubmitting(true)

        try {
            // V5: auto-detected, no dropdown. The server validates and falls back to 'UTC'.
            const timezone = detectTimezone()

            const response = await axiosInstance.post<ApiResponse<AuthPayload>>(
                API_PATHS.AUTH.REGISTER,
                {
                    fullName,
                    email,
                    password,
                    ...(timezone ? { timezone } : {}),
                    ...(captchaEnabled ? { captchaToken } : {}),
                    // Submitting the form is the agreement (the clickwrap line sits under the
                    // button); the checkbox is the separate 18+ attestation. The server stamps
                    // which document versions these refer to - see backend/utils/legalVersions.ts.
                    acceptedTerms: true,
                    ageAttested: true,
                }
            )

            const payload = parseAuthPayload(response)
            await setAuthSession(payload)
            updateUser(payload.user)
            toast.success('Account created! Check your email to verify your address.')
            navigate('/dashboard')
        } catch (err) {
            if (captchaEnabled) setCaptchaToken('')
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
                <h3 className="text-xl font-semibold text-fg">Create an account</h3>
                <p className="text-xs text-fg-muted mt-1 mb-6">Join {BRAND.name} and start tracking your finances</p>

                <form onSubmit={handleSignup}>
                    <Input
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        label="Full Name"
                        placeholder="Your name"
                        type="text"
                        disabled={isSubmitting}
                    />

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
                        placeholder="Minimum 12 characters"
                        type="password"
                        disabled={isSubmitting}
                    />

                    {captchaEnabled && (
                        <Captcha onVerify={setCaptchaToken} onExpire={() => setCaptchaToken('')} />
                    )}

                    <label
                        htmlFor="age-attestation"
                        className="flex items-start gap-2.5 pt-1 pb-2 text-[13px] text-fg-muted cursor-pointer"
                    >
                        <input
                            id="age-attestation"
                            type="checkbox"
                            checked={ageAttested}
                            onChange={(e) => setAgeAttested(e.target.checked)}
                            disabled={isSubmitting}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-accent cursor-pointer"
                        />
                        <span>I am 18 years of age or older.</span>
                    </label>

                    {error && <p className="text-expense text-xs pb-2.5">{error}</p>}
                    {!online && <OfflineNotice message="You are offline. Sign up requires a connection." />}

                    <button
                        type="submit"
                        className="btn-primary"
                        disabled={isSubmitting || !online || (captchaEnabled && !captchaToken)}
                    >
                        {isSubmitting ? 'Creating account...' : 'Sign up'}
                    </button>

                    <p className="text-[13px] text-fg-muted mt-3">
                        By creating an account you agree to our{' '}
                        <Link className="font-medium text-accent hover:text-accent" to="/terms">
                            Terms of Service
                        </Link>{' '}
                        and acknowledge our{' '}
                        <Link className="font-medium text-accent hover:text-accent" to="/privacy">
                            Privacy Policy
                        </Link>
                        .
                    </p>

                    <p className="text-[13px] text-fg-muted mt-3">
                        Already have an account?{' '}
                        <Link className="font-medium text-accent hover:text-accent" to="/login">
                            Sign in
                        </Link>
                    </p>
                </form>
            </div>
        </AuthLayout>
    )
}

export default Signup
