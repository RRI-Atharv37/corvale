import React from 'react'
import type { Account } from '../../types/api'
import { formatCurrency } from '../../utils/format'

interface AccountMultiSelectProps {
    accounts: Account[]
    selectedIds: string[]
    onChange: (ids: string[]) => void
    disabled?: boolean
}

const AccountMultiSelect: React.FC<AccountMultiSelectProps> = ({
    accounts,
    selectedIds,
    onChange,
    disabled,
}) => {
    const allSelected = accounts.length > 0 && selectedIds.length === 0

    const toggleAll = () => {
        if (allSelected) {
            onChange(accounts.map((account) => account._id))
        } else {
            onChange([])
        }
    }

    const toggleAccount = (accountId: string) => {
        if (selectedIds.length === 0) {
            onChange(accounts.filter((a) => a._id !== accountId).map((a) => a._id))
            return
        }

        if (selectedIds.includes(accountId)) {
            const next = selectedIds.filter((id) => id !== accountId)
            onChange(next)
        } else {
            onChange([...selectedIds, accountId])
        }
    }

    const isAccountSelected = (accountId: string): boolean =>
        allSelected || selectedIds.includes(accountId)

    if (accounts.length === 0) {
        return (
            <p className="text-xs text-amber-400">
                No accounts available. Create an account first to scope this budget.
            </p>
        )
    }

    return (
        <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer group">
                <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    disabled={disabled}
                    className="rounded border-slate-600 bg-slate-900 text-cyan-400 focus:ring-cyan-500/40"
                />
                <span className="text-sm text-slate-300 group-hover:text-slate-200">
                    All accounts
                </span>
            </label>
            <div className="ml-1 space-y-1.5 border-l border-slate-800 pl-3">
                {accounts.map((account) => (
                    <label
                        key={account._id}
                        className="flex items-center justify-between gap-3 cursor-pointer group"
                    >
                        <span className="flex items-center gap-2 min-w-0">
                            <input
                                type="checkbox"
                                checked={isAccountSelected(account._id)}
                                onChange={() => toggleAccount(account._id)}
                                disabled={disabled || allSelected}
                                className="rounded border-slate-600 bg-slate-900 text-cyan-400 focus:ring-cyan-500/40 disabled:opacity-50"
                            />
                            <span className="text-sm text-slate-300 truncate group-hover:text-slate-200">
                                {account.name}
                            </span>
                        </span>
                        <span className="text-[11px] text-slate-500 shrink-0">
                            {formatCurrency(account.currentBalance, account.currency)}
                        </span>
                    </label>
                ))}
            </div>
            <p className="text-[11px] text-slate-500">
                {allSelected
                    ? 'Expenses from all accounts count toward this budget.'
                    : selectedIds.length === 0
                      ? 'Select at least one account, or check "All accounts".'
                      : `${selectedIds.length} account${selectedIds.length === 1 ? '' : 's'} selected.`}
            </p>
        </div>
    )
}

export default AccountMultiSelect
