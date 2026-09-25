import { useState } from 'react'
import AuthLayout from '@ui/layouts/AuthLayout'
import { Link, useSearchParams } from 'react-router-dom'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { getApiErrorMessage } from '@lib/apiError'
import { useOnlineStatus } from '@platform/offline/useOnlineStatus'
import OfflineNotice from '@ui/OfflineNotice'

const UnsubscribePage = () => {
    const [searchParams] = useSearchParams()
    const token = searchParams.get('token') ?? ''
    const online = useOnlineStatus()

    const [done, setDone] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)

    const handleUnsubscribe = async () => {
        setError(null)
        setIsSubmitting(true)

        try {
            await axiosInstance.post(API_PATHS.AUTH.EMAIL_PREFERENCES_UNSUBSCRIBE, { token })
            setDone(true)
        } catch (err) {
            setError(getApiErrorMessage(err, 'Unable to unsubscribe. Please try again.'))
        } finally {
            setIsSubmitting(false)
        }
    }

    if (!token) {
        return (
            <AuthLayout>
                <div>
                    <h3 className="text-xl font-semibold text-fg">Invalid unsubscribe link</h3>
                    <p className="text-sm text-fg-muted mt-2 mb-4">This unsubscribe link is missing or incomplete.</p>
                    <Link className="text-sm font-medium text-accent hover:text-accent" to="/login">
                        Back to sign in
                    </Link>
                </div>
            </AuthLayout>
        )
    }

    if (done) {
        return (
            <AuthLayout>
                <div>
                    <h3 className="text-xl font-semibold text-fg">You've been unsubscribed</h3>
                    <p className="text-sm text-fg-muted mt-2 mb-4">
                        We won't send you any more emails like that one. Messages about your account, such as billing and
                        security notices, still reach you.
                    </p>
                    <Link className="text-sm font-medium text-accent hover:text-accent" to="/login">
                        Back to sign in
                    </Link>
                </div>
            </AuthLayout>
        )
    }

    return (
        <AuthLayout>
            <div>
                <h3 className="text-xl font-semibold text-fg">Unsubscribe</h3>
                <p className="text-xs text-fg-muted mt-1 mb-6">
                    Stop the occasional Corvale emails that are not about your account. Billing and security notices are not affected.
                </p>

                {error && <p className="text-expense text-xs pb-2.5">{error}</p>}
                {!online && <OfflineNotice message="You are offline. Unsubscribing requires a connection." />}

                <button type="button" className="btn-primary" onClick={handleUnsubscribe} disabled={isSubmitting || !online}>
                    {isSubmitting ? 'Unsubscribing...' : 'Unsubscribe'}
                </button>
            </div>
        </AuthLayout>
    )
}

export default UnsubscribePage
