import React, { useCallback } from 'react'
import { useAsyncData } from '../../hooks/useAsyncData'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import type { Account, ApiResponse } from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import { formatCurrency } from '../../utils/format'

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
    const fetchAccounts = useCallback(async (): Promise<Account[]> => {
        try {
            const response = await axiosInstance.get<ApiResponse<Account[]>>(
                API_PATHS.ACCOUNTS.GET_ALL
            )
            return unwrapApiData(response)
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load accounts'))
        }
    }, [])

    const { data, loading, error } = useAsyncData(fetchAccounts, [fetchAccounts])

    const accounts = accountsData ?? data?.filter((account) => !account.isArchived)
    const isLoading = !accountsData && loading
    const loadError = !accountsData ? error : null

    if (isLoading) {
        return (
            <div>
                <label className="text-[13px] text-slate-300">{label}</label>
                <p className="text-xs text-slate-500 mt-2">Loading accounts...</p>
            </div>
        )
    }

    if (loadError) {
        return (
            <div>
                <label className="text-[13px] text-slate-300">{label}</label>
                <p className="text-xs text-rose-400 mt-2">{loadError}</p>
            </div>
        )
    }

    if (!accounts || accounts.length === 0) {
        return (
            <div>
                <label className="text-[13px] text-slate-300">{label}</label>
                <p className="text-xs text-amber-400 mt-2">
                    No accounts yet. Create one on the Accounts page first.
                </p>
            </div>
        )
    }

    const selected = accounts.find((account) => account._id === value)

    return (
        <div>
            <label className="text-[13px] text-slate-300">
                {label}
                {required && <span className="text-rose-400 ml-0.5">*</span>}
            </label>
            <div className="input-box mb-0 mt-1">
                <select
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    required={required}
                    disabled={disabled}
                    className="w-full bg-transparent outline-none text-slate-200"
                >
                    <option value="" className="bg-slate-900">
                        Select an account
                    </option>
                    {accounts.map((account) => (
                        <option key={account._id} value={account._id} className="bg-slate-900">
                            {account.name} ({formatAccountType(account.type)})
                            {account.isDefault ? ' · Default' : ''}
                        </option>
                    ))}
                </select>
            </div>
            {selected && (
                <p className="text-xs text-slate-500 mt-2">
                    Balance: {formatCurrency(selected.currentBalance, selected.currency)}
                </p>
            )}
        </div>
    )
}

export default AccountPicker
