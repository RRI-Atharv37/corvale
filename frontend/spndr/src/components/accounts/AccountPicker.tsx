import React, { useCallback, useId } from 'react'
import { useAsyncData } from '../../hooks/useAsyncData'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import type { Account, ApiResponse } from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import { formatCurrency } from '../../utils/format'
import { useWorkspace } from '../../hooks/useWorkspace'
import { buildWorkspaceQueryParams } from '../../utils/workspaceScope'

export interface AccountPickerProps {
    value: string
    onChange: (accountId: string) => void
    label?: string
    required?: boolean
    disabled?: boolean
    accountsData?: Account[]
}

const formatAccountType = (type: Account['type']): string => {
    const labels: Record<Account['type'], string> = {
        checking: 'Checking',
        cash: 'Cash',
        credit: 'Credit',
        savings: 'Savings',
    }
    return labels[type]
}

const AccountPicker: React.FC<AccountPickerProps> = ({
    value,
    onChange,
    label = 'Account',
    required,
    disabled,
    accountsData,
}) => {
    const { activeWorkspaceId } = useWorkspace()
    const selectId = useId()

    const fetchAccounts = useCallback(async (): Promise<Account[]> => {
        try {
            const response = await axiosInstance.get<ApiResponse<Account[]>>(
                API_PATHS.ACCOUNTS.GET_ALL,
                { params: buildWorkspaceQueryParams(activeWorkspaceId) }
            )
            return unwrapApiData(response)
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load accounts'))
        }
    }, [activeWorkspaceId])

    const { data, loading, error } = useAsyncData(fetchAccounts, [fetchAccounts])

    const accounts = accountsData ?? data?.filter((account) => !account.isArchived)
    const isLoading = !accountsData && loading
    const loadError = !accountsData ? error : null

    if (isLoading) {
        return (
            <div>
                <label htmlFor={selectId} className="text-[13px] text-fg-secondary">{label}</label>
                <p role="status" aria-live="polite" className="text-xs text-fg-muted mt-2">Loading accounts...</p>
            </div>
        )
    }

    if (loadError) {
        return (
            <div>
                <label htmlFor={selectId} className="text-[13px] text-fg-secondary">{label}</label>
                <p className="text-xs text-expense mt-2">{loadError}</p>
            </div>
        )
    }

    if (!accounts || accounts.length === 0) {
        return (
            <div>
                <label htmlFor={selectId} className="text-[13px] text-fg-secondary">{label}</label>
                <p className="text-xs text-warning mt-2">
                    No accounts yet. Create one on the Accounts page first.
                </p>
            </div>
        )
    }

    const selected = accounts.find((account) => account._id === value)

    return (
        <div>
            <label htmlFor={selectId} className="text-[13px] text-fg-secondary">
                {label}
                {required && <span className="text-expense ml-0.5">*</span>}
            </label>
            <div className="input-box mb-0 mt-1">
                <select
                    id={selectId}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    required={required}
                    disabled={disabled}
                    className="w-full bg-transparent outline-none text-fg"
                >
                    <option value="" className="bg-surface">
                        Select an account
                    </option>
                    {accounts.map((account) => (
                        <option key={account._id} value={account._id} className="bg-surface">
                            {account.name} ({formatAccountType(account.type)})
                            {account.isDefault ? ' · Default' : ''}
                        </option>
                    ))}
                </select>
            </div>
            {selected && (
                <p className="text-xs text-fg-muted mt-2">
                    Balance: {formatCurrency(selected.currentBalance, selected.currency)}
                </p>
            )}
        </div>
    )
}

export default AccountPicker
