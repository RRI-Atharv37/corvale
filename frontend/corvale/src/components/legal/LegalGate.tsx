import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { getApiErrorMessage } from '../../utils/apiError'
import { unwrapApiData } from '../../utils/apiHelpers'
import { exportPersonalBackup } from '../../utils/personalBackupExport'
import { useUser } from '../../hooks/useUser'
import DeleteAccountSettings from '../settings/DeleteAccountSettings'
import type { ApiResponse, User } from '../../types/api'

/**
 * Blocks the dashboard until the signed-in user has accepted the current Terms and Privacy
 * Policy (M0c).
 *
 * Two situations reach this gate:
 *
 *   1. An account created before versioned consent shipped, which has no `legalAcceptance` at
 *      all. Those users accept once and are never asked again. This is why the server stores the
 *      field as genuinely absent rather than defaulting it - "no record" has to be detectable.
 *   2. A document was changed materially and its version bumped in
 *      `backend/utils/legalVersions.ts`, making every stored acceptance stale.
 *
 * Deliberately *not* dismissible: continuing to use the service without current terms is the
 * exact state this exists to prevent.
 *
 * SEC-48: the privacy policy promises that export and deletion are *never* gated on anything -
 * "Export is never restricted, in any circumstances" - and GDPR Art. 7(3)/17/20 must not be
 * coupled to accepting new terms. So the gate carries its own sign-out, export and
 * delete-account controls; the dashboard's Settings screen is the only thing walled off.
 */
const LegalGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, updateUser, logout } = useUser()
    const navigate = useNavigate()
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isExporting, setIsExporting] = useState(false)
    const [isSigningOut, setIsSigningOut] = useState(false)

    // Until the profile has loaded there is nothing to compare, so let children render rather
    // than flashing a consent wall at every page load.
    const versions = user?.legalVersions
    const accepted = user?.legalAcceptance

    const needsAcceptance =
        !!user &&
        !!versions &&
        (!accepted ||
            accepted.termsVersion !== versions.termsVersion ||
            accepted.privacyVersion !== versions.privacyVersion)

    if (!needsAcceptance) {
        return <>{children}</>
    }

    const isFirstTime = !accepted

    const handleAccept = async () => {
        setIsSubmitting(true)
        try {
            // The shared axios instance unwraps to the API body in its response interceptor, so
            // `unwrapApiData` - not `response.data.data` - is the correct accessor here.
            const response = await axiosInstance.post<ApiResponse<User>>(API_PATHS.AUTH.LEGAL_ACCEPT, {})
            updateUser(unwrapApiData(response))
            toast.success('Thanks - you are all set.')
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Could not record your acceptance. Please try again.'))
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleExport = async () => {
        setIsExporting(true)
        try {
            await exportPersonalBackup()
            toast.success('Your data export has been downloaded.')
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Could not export your data. Please try again.'))
        } finally {
            setIsExporting(false)
        }
    }

    const handleSignOut = async () => {
        setIsSigningOut(true)
        try {
            await logout()
            navigate('/', { replace: true })
        } finally {
            setIsSigningOut(false)
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
            <div className="w-full max-w-lg rounded-xl border border-border-subtle bg-elevated p-6 sm:p-8">
                <h1 className="font-display text-xl font-semibold text-text-primary">
                    {isFirstTime ? 'One quick thing' : 'We have updated our terms'}
                </h1>

                <p className="mt-3 text-sm leading-relaxed text-text-secondary">
                    {isFirstTime
                        ? 'Before you carry on, please review and accept the documents covering your use of Corvale. This only happens once.'
                        : 'Our Terms of Service or Privacy Policy have changed since you last accepted them. Please review the current versions to continue.'}
                </p>

                <ul className="mt-5 space-y-2 text-sm">
                    <li>
                        <Link
                            to="/terms"
                            className="text-accent underline underline-offset-2 hover:opacity-80"
                        >
                            Terms of Service
                        </Link>
                    </li>
                    <li>
                        <Link
                            to="/privacy"
                            className="text-accent underline underline-offset-2 hover:opacity-80"
                        >
                            Privacy Policy
                        </Link>
                    </li>
                </ul>

                <p className="mt-5 text-xs leading-relaxed text-fg-muted">
                    Corvale is a record-keeping tool and does not provide financial advice. You must be
                    18 or older to use it. Your data stays exportable and deletable at any time.
                </p>

                <button
                    type="button"
                    onClick={handleAccept}
                    disabled={isSubmitting}
                    className="btn-primary mt-6 w-full"
                >
                    {isSubmitting ? 'Saving...' : 'I agree'}
                </button>

                <div className="mt-6 border-t border-border-subtle pt-5">
                    <p className="text-xs text-fg-muted">
                        You do not have to accept to leave, take your data, or close your account.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={handleSignOut}
                            disabled={isSigningOut}
                            className="inline-flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-primary hover:border-accent/40 disabled:opacity-50"
                        >
                            {isSigningOut ? 'Signing out…' : 'Sign out'}
                        </button>
                        <button
                            type="button"
                            onClick={handleExport}
                            disabled={isExporting}
                            className="inline-flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-primary hover:border-accent/40 disabled:opacity-50"
                        >
                            {isExporting ? 'Exporting…' : 'Export my data'}
                        </button>
                    </div>

                    <div className="mt-4">
                        <DeleteAccountSettings />
                    </div>
                </div>
            </div>
        </div>
    )
}

export default LegalGate
