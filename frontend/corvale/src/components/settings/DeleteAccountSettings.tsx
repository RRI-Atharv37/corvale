import React, { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FiAlertTriangle } from 'react-icons/fi'

import { useUser } from '../../hooks/useUser'
import { useAsyncData } from '../../hooks/useAsyncData'
import { getApiErrorMessage } from '../../utils/apiError'
import { unwrapApiData } from '../../utils/apiHelpers'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'

interface AccountDeletionImpact {
    retainedRecordCount: number
    affectedWorkspaces: { workspaceId: string; name: string }[]
}

const DeleteAccountSettings: React.FC = () => {
    const { deleteAccount } = useUser()
    const navigate = useNavigate()

    const [expanded, setExpanded] = useState(false)
    const [password, setPassword] = useState('')
    const [deleting, setDeleting] = useState(false)

    // Only fires once the danger-zone panel is actually opened - no need to hit the server on
    // every Settings page load for a warning nobody may ever see.
    const fetchImpact = useCallback(async (): Promise<AccountDeletionImpact | null> => {
        if (!expanded) {
            return null
        }
        try {
            const response = await axiosInstance.get(API_PATHS.AUTH.DELETE_ACCOUNT_IMPACT)
            return unwrapApiData(response) as AccountDeletionImpact
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to check what will be affected'))
        }
    }, [expanded])

    const { data: impact } = useAsyncData(fetchImpact, [expanded])

    const handleCancel = () => {
        setExpanded(false)
        setPassword('')
    }

    const handleDelete = async () => {
        if (!password) {
            toast.error('Enter your password to confirm')
            return
        }

        const confirmed = window.confirm(
            'This permanently deletes your account and all of your data. This cannot be undone. Continue?'
        )
        if (!confirmed) return

        setDeleting(true)
        try {
            await deleteAccount(password)
            toast.success('Account deleted')
            navigate('/', { replace: true })
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to delete account'))
            setPassword('')
        } finally {
            setDeleting(false)
        }
    }

    return (
        <div>
            <p className="section-label mb-3 text-destructive">Danger zone</p>

            {!expanded ? (
                <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="flex w-full items-center gap-3 rounded-lg border border-destructive/30 px-3 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
                >
                    <FiAlertTriangle size={18} />
                    Delete my account
                </button>
            ) : (
                <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                    <p className="text-sm text-text-primary">
                        Deleting your account permanently erases your transactions, accounts, budgets, and
                        every other record tied to it. Export your data first if you want a copy — this
                        cannot be undone.
                    </p>
                    {impact && impact.retainedRecordCount > 0 && (
                        <p className="rounded-md border border-destructive/20 bg-bg-secondary/60 p-3 text-sm text-text-secondary">
                            You have {impact.retainedRecordCount}{' '}
                            {impact.retainedRecordCount === 1 ? 'record' : 'records'} in{' '}
                            {impact.affectedWorkspaces.length}{' '}
                            {impact.affectedWorkspaces.length === 1 ? 'shared workspace' : 'shared workspaces'}
                            {' '}
                            (
                            {impact.affectedWorkspaces.map((workspace) => workspace.name).join(', ')}
                            ). These will stay in{' '}
                            {impact.affectedWorkspaces.length === 1 ? 'that workspace' : 'those workspaces'}{' '}
                            but will no longer be linked to you.
                        </p>
                    )}
                    <label className="block text-sm text-text-secondary">
                        Confirm your password
                        <input
                            type="password"
                            autoComplete="current-password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            disabled={deleting}
                            className="mt-1 w-full rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-destructive/40 focus:outline-none"
                        />
                    </label>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            disabled={deleting}
                            onClick={() => void handleDelete()}
                            className="inline-flex items-center gap-2 rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-white hover:bg-destructive/90 disabled:opacity-50"
                        >
                            {deleting ? 'Deleting…' : 'Permanently delete my account'}
                        </button>
                        <button
                            type="button"
                            disabled={deleting}
                            onClick={handleCancel}
                            className="inline-flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-primary hover:border-accent/40 disabled:opacity-50"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

export default DeleteAccountSettings
