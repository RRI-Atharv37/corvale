import React, { useState } from 'react'
import AuthLayout from '../../components/layouts/AuthLayout'
import { Link, useNavigate } from 'react-router-dom'
import Input from '../../components/inputs/Input'
import { validateEmail } from '../../utils/helper'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { parseAuthPayload, setAuthSession } from '../../context/UserContext'
import { useUser } from '../../hooks/useUser'
import type { ApiResponse, AuthPayload } from '../../types/api'
import { getApiErrorMessage } from '../../utils/apiError'
import toast from 'react-hot-toast'

const Signup = () => {
    const [fullName, setFullName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const navigate = useNavigate()
    const { updateUser } = useUser()

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

        setError('')
        setIsSubmitting(true)

        try {
            const response = await axiosInstance.post<ApiResponse<AuthPayload>>(
                API_PATHS.AUTH.REGISTER,
                { fullName, email, password }
            )

            const { token, user } = parseAuthPayload(response)
            setAuthSession({ token, user })
            updateUser(user)
            toast.success('Account created successfully!')
            navigate('/dashboard')
        } catch (err) {
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
                <p className="text-xs text-fg-muted mt-1 mb-6">Join spndr and start tracking your finances</p>

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
                        placeholder="Minimum 8 characters"
                        type="password"
                        disabled={isSubmitting}
                    />

                    {error && <p className="text-expense text-xs pb-2.5">{error}</p>}

                    <button type="submit" className="btn-primary" disabled={isSubmitting}>
                        {isSubmitting ? 'Creating account...' : 'Sign up'}
                    </button>

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
