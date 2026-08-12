import React, { useCallback, useState } from 'react'
import toast from 'react-hot-toast'
import { IoAdd, IoPencil, IoStar, IoStarOutline, IoTrash } from 'react-icons/io5'
import PageHeader from '../../components/ui/PageHeader'
import AsyncContent from '../../components/ui/AsyncContent'
import Modal from '../../components/ui/Modal'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import FormField from '../../components/forms/FormField'
import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { useAsyncData } from '../../hooks/useAsyncData'
import type { Account, AccountEditFormData, AccountFormData, AccountType, ApiResponse } from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import { formatCurrency } from '../../utils/format'

const ACCOUNT_TYPE_OPTIONS: { value: AccountType; label: string }[] = [
    { value: 'checking', label: 'Checking' },
    { value: 'cash', label: 'Cash' },
    { value: 'credit', label: 'Credit' },
    { value: 'savings', label: 'Savings' },
]

const CURRENCY_OPTIONS = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD'] as const

const emptyCreateForm = (): AccountFormData => ({
    name: '',
    type: 'checking',
    currency: 'USD',
    openingBalance: '0',
})

const emptyEditForm = (): AccountEditFormData => ({
    name: '',
    type: 'checking',
})

const formatAccountType = (type: AccountType): string =>
    ACCOUNT_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type

interface SelectFieldProps {
    label: string
    value: string
    onChange: (value: string) => void
    options: { value: string; label: string }[]
    required?: boolean
    disabled?: boolean
}

const SelectField: React.FC<SelectFieldProps> = ({
    label,
    value,
    onChange,
    options,
    required,
    disabled,
}) => (
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
                {options.map((option) => (
                    <option key={option.value} value={option.value} className="bg-slate-900">
                        {option.label}
                    </option>
                ))}
            </select>
        </div>
    </div>
)

const Accounts = () => {
    const [createOpen, setCreateOpen] = useState(false)
    const [editOpen, setEditOpen] = useState(false)
    const [createForm, setCreateForm] = useState<AccountFormData>(emptyCreateForm)
    const [editForm, setEditForm] = useState<AccountEditFormData>(emptyEditForm)
    const [editingAccount, setEditingAccount] = useState<Account | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [archiveTarget, setArchiveTarget] = useState<Account | null>(null)
    const [archiving, setArchiving] = useState(false)
    const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null)

    const fetchAccounts = useCallback(async (): Promise<Account[]> => {
        try {
            const response = await axiosInstance.get<ApiResponse<Account[]>>(API_PATHS.ACCOUNTS.GET_ALL)
            return unwrapApiData(response)
        } catch (error) {
            throw new Error(getApiErrorMessage(error, 'Failed to load accounts'))
        }
    }, [])

    const { data: accounts, loading, error, refetch } = useAsyncData(fetchAccounts, [fetchAccounts])

    const openCreate = () => {
        setCreateForm(emptyCreateForm())
        setCreateOpen(true)
    }

    const closeCreate = () => {
        setCreateOpen(false)
        setCreateForm(emptyCreateForm())
    }

    const openEdit = (account: Account) => {
        setEditingAccount(account)
        setEditForm({
            name: account.name,
            type: account.type,
        })
        setEditOpen(true)
    }

    const closeEdit = () => {
        setEditOpen(false)
        setEditingAccount(null)
        setEditForm(emptyEditForm())
    }

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!createForm.name.trim()) {
            toast.error('Account name is required')
            return
        }

        const openingBalance = Number(createForm.openingBalance)
        if (isNaN(openingBalance)) {
            toast.error('Opening balance must be a valid number')
            return
        }

        setSubmitting(true)
        try {
            await axiosInstance.post(API_PATHS.ACCOUNTS.CREATE, {
                name: createForm.name.trim(),
                type: createForm.type,
                currency: createForm.currency,
                openingBalance,
            })
            toast.success('Account created')
            closeCreate()
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to create account'))
        } finally {
            setSubmitting(false)
        }
    }

    const handleEdit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editingAccount) return

        if (!editForm.name.trim()) {
            toast.error('Account name is required')
            return
        }

        setSubmitting(true)
        try {
            await axiosInstance.put(API_PATHS.ACCOUNTS.UPDATE(editingAccount._id), {
                name: editForm.name.trim(),
                type: editForm.type,
            })
            toast.success('Account updated')
            closeEdit()
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to update account'))
        } finally {
            setSubmitting(false)
        }
    }

    const handleSetDefault = async (account: Account) => {
        if (account.isDefault) return

        setSettingDefaultId(account._id)
        try {
            await axiosInstance.put(API_PATHS.ACCOUNTS.UPDATE(account._id), { isDefault: true })
            toast.success(`"${account.name}" is now your default account`)
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to set default account'))
        } finally {
            setSettingDefaultId(null)
        }
    }

    const handleArchive = async () => {
        if (!archiveTarget) return

        setArchiving(true)
        try {
            await axiosInstance.delete(API_PATHS.ACCOUNTS.DELETE(archiveTarget._id))
            toast.success('Account archived')
            setArchiveTarget(null)
            await refetch()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Failed to archive account'))
        } finally {
            setArchiving(false)
        }
    }

    return (
        <div>
            <PageHeader
                title="Accounts"
                description="Manage your checking, savings, and cash accounts"
                actions={
                    <button
                        type="button"
                        onClick={openCreate}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors"
                    >
                        <IoAdd size={18} />
                        Add account
                    </button>
                }
            />

            <AsyncContent
                loading={loading}
                error={error}
                data={accounts}
                isEmpty={(items) => items.length === 0}
                loadingMessage="Loading accounts..."
                emptyTitle="No accounts yet"
                emptyDescription="Create your first account to start tracking balances."
                onRetry={refetch}
            >
                {(items) => (
                    <div className="space-y-3">
                        {items.map((account) => (
                            <div key={account._id} className="card flex items-center justify-between gap-4">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <p className="text-sm font-medium text-slate-200 truncate">
                                            {account.name}
                                        </p>
                                        {account.isDefault && (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 text-[11px] font-medium text-cyan-300">
                                                <IoStar size={12} />
                                                Default
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        {formatAccountType(account.type)} · {account.currency}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    <div className="text-right">
                                        <p className="text-sm font-semibold text-cyan-400">
                                            {formatCurrency(account.currentBalance, account.currency)}
                                        </p>
                                        <p className="text-[11px] text-slate-500">Current balance</p>
                                    </div>
                                    {!account.isDefault && (
                                        <button
                                            type="button"
                                            onClick={() => handleSetDefault(account)}
                                            disabled={settingDefaultId === account._id}
                                            className="p-1.5 text-slate-400 hover:text-amber-400 transition-colors disabled:opacity-50"
                                            aria-label="Set as default account"
                                            title="Set as default"
                                        >
                                            <IoStarOutline size={16} />
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => openEdit(account)}
                                        className="p-1.5 text-slate-400 hover:text-cyan-400 transition-colors"
                                        aria-label="Edit account"
                                    >
                                        <IoPencil size={16} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setArchiveTarget(account)}
                                        className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors"
                                        aria-label="Archive account"
                                    >
                                        <IoTrash size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </AsyncContent>

            <Modal open={createOpen} onClose={closeCreate} title="Add account">
                <form onSubmit={handleCreate} className="space-y-4">
                    <FormField
                        label="Name"
                        value={createForm.name}
                        onChange={(v) => setCreateForm((f) => ({ ...f, name: v }))}
                        placeholder="Main checking, Cash wallet, etc."
                        required
                        disabled={submitting}
                    />
                    <SelectField
                        label="Type"
                        value={createForm.type}
                        onChange={(v) =>
                            setCreateForm((f) => ({ ...f, type: v as AccountType }))
                        }
                        options={ACCOUNT_TYPE_OPTIONS}
                        required
                        disabled={submitting}
                    />
                    <SelectField
                        label="Currency"
                        value={createForm.currency}
                        onChange={(v) => setCreateForm((f) => ({ ...f, currency: v }))}
                        options={CURRENCY_OPTIONS.map((currency) => ({
                            value: currency,
                            label: currency,
                        }))}
                        required
                        disabled={submitting}
                    />
                    <FormField
                        label="Opening balance"
                        type="number"
                        value={createForm.openingBalance}
                        onChange={(v) => setCreateForm((f) => ({ ...f, openingBalance: v }))}
                        placeholder="0.00"
                        required
                        disabled={submitting}
                        step="0.01"
                    />
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={closeCreate}
                            disabled={submitting}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-slate-700 text-slate-300 hover:border-slate-600 transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors disabled:opacity-50"
                        >
                            {submitting ? 'Creating...' : 'Create account'}
                        </button>
                    </div>
                </form>
            </Modal>

            <Modal open={editOpen} onClose={closeEdit} title="Edit account">
                <form onSubmit={handleEdit} className="space-y-4">
                    <FormField
                        label="Name"
                        value={editForm.name}
                        onChange={(v) => setEditForm((f) => ({ ...f, name: v }))}
                        placeholder="Account name"
                        required
                        disabled={submitting}
                    />
                    <SelectField
                        label="Type"
                        value={editForm.type}
                        onChange={(v) => setEditForm((f) => ({ ...f, type: v as AccountType }))}
                        options={ACCOUNT_TYPE_OPTIONS}
                        required
                        disabled={submitting}
                    />
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={closeEdit}
                            disabled={submitting}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg border border-slate-700 text-slate-300 hover:border-slate-600 transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors disabled:opacity-50"
                        >
                            {submitting ? 'Saving...' : 'Save changes'}
                        </button>
                    </div>
                </form>
            </Modal>

            <ConfirmDialog
                open={archiveTarget !== null}
                onClose={() => setArchiveTarget(null)}
                onConfirm={handleArchive}
                title="Archive account"
                message={`Are you sure you want to archive "${archiveTarget?.name}"? It will be hidden from your account list.`}
                confirmLabel="Archive"
                loading={archiving}
            />
        </div>
    )
}

export default Accounts
